import { cpus, freemem, hostname, loadavg, totalmem } from 'node:os';
import WebSocket from 'ws';
import type { GatewayMessage } from '@hatch-radar/kernel';
import { logger } from '@hatch-radar/kernel';
import type { AppEnv } from './env';
import type { WorkerService } from './worker.service';

const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** 主动向网关发 WS ping 探活的周期 */
const LIVENESS_PING_INTERVAL_MS = 15_000;
/** 发 ping 后等 pong 的上限；超时即判定连接半开（对端已死但 TCP 未报错），强制重连 */
const PONG_TIMEOUT_MS = 10_000;

/**
 * Worker 侧 WebSocket 客户端（框架无关纯类）：连接 GatewayService，接收分发的任务交给 WorkerService 执行。
 * 启动时 register → 等待 dispatch → 执行 → 回报 job_result；断连后指数退避重连。
 *
 * 由各端（独立 worker 进程 / api 内嵌 worker）直接 `new WorkerAgentService(env, worker).start()`。
 */
export class WorkerAgentService {
  private ws: WebSocket | null = null;
  private stopping = false;
  private reconnectDelay = RECONNECT_BASE_MS;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadline: ReturnType<typeof setTimeout> | null = null;
  private readonly workerId = `${hostname()}-${process.pid.toString()}`;

  constructor(
    private readonly env: AppEnv,
    private readonly worker: WorkerService,
  ) {}

  /** 启动 WS 客户端并连接网关。 */
  start(): void {
    this.connect();
  }

  /** 停止（优雅退出）。 */
  stop(): void {
    this.stopping = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.stopLiveness();
    this.ws?.close();
  }

  private gatewayUrl(): string {
    return this.env.gatewayUrl ?? `ws://localhost:${this.env.http.port}/ws/worker`;
  }

  private connect(): void {
    if (this.stopping) return;
    const url = this.gatewayUrl();
    logger.info(`[worker-agent] 连接网关 ${url}`);
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.send({
        type: 'register',
        workerId: this.workerId,
        concurrency: this.env.worker.concurrency,
      });
      this.startHeartbeat();
      this.startLiveness();
      logger.info(`[worker-agent] 已连接（worker: ${this.workerId}）`);
    });

    // ws 库自动回 pong：收到即认为连接存活，撤销本轮超时判定
    this.ws.on('pong', () => {
      if (this.pongDeadline) {
        clearTimeout(this.pongDeadline);
        this.pongDeadline = null;
      }
    });

    this.ws.on('message', (raw) => {
      let msg: GatewayMessage;
      try {
        msg = JSON.parse(raw.toString()) as GatewayMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    this.ws.on('error', (err) => {
      logger.warn(`[worker-agent] WS 错误: ${err.message}`);
    });

    this.ws.on('close', () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.stopLiveness();
      if (!this.stopping) {
        logger.warn(`[worker-agent] 连接断开，${this.reconnectDelay}ms 后重连`);
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      }
    });
  }

  private handleMessage(msg: GatewayMessage): void {
    switch (msg.type) {
      case 'registered':
        logger.info(`[worker-agent] 注册成功（${msg.workerId}）`);
        break;
      case 'dispatch':
        void this.executeJob(msg);
        break;
      case 'dispatch_task':
        void this.executeTask(msg);
        break;
    }
  }

  private async executeJob(dispatch: Extract<GatewayMessage, { type: 'dispatch' }>): Promise<void> {
    const { jobId, postId, providerId } = dispatch;
    try {
      await this.worker.executeDispatchedJob(
        { id: jobId, post_id: postId, provider_id: providerId },
        (jid) => this.send({ type: 'job_progress', workerId: this.workerId, jobId: jid }),
      );
      this.send({ type: 'job_result', workerId: this.workerId, jobId, status: 'succeeded' });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.send({ type: 'job_result', workerId: this.workerId, jobId, status: 'failed', error });
    }
  }

  /**
   * 执行一条分发来的任务（新执行模型）。worker 按 taskId 回查整行 + 环节后逐步执行；
   * 任务内核自带 DB 心跳，故无需 progress 回报。完成 / 失败回报 task_result。
   */
  private async executeTask(
    dispatch: Extract<GatewayMessage, { type: 'dispatch_task' }>,
  ): Promise<void> {
    const { taskId } = dispatch;
    try {
      await this.worker.executeDispatchedTask(taskId);
      this.send({ type: 'task_result', workerId: this.workerId, taskId, status: 'succeeded' });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.send({ type: 'task_result', workerId: this.workerId, taskId, status: 'failed', error });
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      const cpuCount = cpus().length || 1;
      const cpu = loadavg()[0] / cpuCount;
      const memory = 1 - freemem() / totalmem();
      this.send({
        type: 'heartbeat',
        workerId: this.workerId,
        cpu,
        memory,
        activeJobs: this.worker.activeJobCount,
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * WS 协议级探活：周期性发 ping，对端 ws 库会自动回 pong（无需网关业务配合）。
   * 若一轮内未收到 pong，判定连接半开（api 异常退出 / 网络静默丢包时 TCP 不及时报错、
   * close 事件不触发），主动 terminate 触发 close → 走既有重连逻辑。纯客户端，不改协议。
   */
  private startLiveness(): void {
    this.stopLiveness();
    this.livenessTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (this.pongDeadline) clearTimeout(this.pongDeadline);
      this.pongDeadline = setTimeout(() => {
        logger.warn('[worker-agent] 探活超时（未收到 pong），判定连接半开，强制重连');
        this.ws?.terminate();
      }, PONG_TIMEOUT_MS);
      try {
        this.ws.ping();
      } catch {
        // ping 写入失败（socket 状态异常）：直接终止以触发重连
        this.ws.terminate();
      }
    }, LIVENESS_PING_INTERVAL_MS);
  }

  private stopLiveness(): void {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
    if (this.pongDeadline) {
      clearTimeout(this.pongDeadline);
      this.pongDeadline = null;
    }
  }

  private send(msg: object): void {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    } catch {
      // socket 已关闭
    }
  }
}
