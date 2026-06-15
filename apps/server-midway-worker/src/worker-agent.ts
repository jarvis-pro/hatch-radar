import { cpus, freemem, hostname, loadavg, totalmem } from 'node:os';
import WebSocket from 'ws';
import { type AppEnv, type GatewayMessage, logger, type WorkerService } from '@hatch-radar/core';

const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Worker 侧 WebSocket 客户端（与 NestJS / 内嵌版逐字等价）：连接 API 的 GatewayService，
 * 接收分发的任务并交给 core 的 WorkerService 执行。
 *
 * 启动时发送 register → 等待 dispatch → 执行 → 回报 job_result；断连后指数退避重连。
 * 纯类（无框架依赖）：由 worker-main 直接 `new` 出来并 start()。
 */
export class WorkerAgentService {
  private ws: WebSocket | null = null;
  private stopping = false;
  private reconnectDelay = RECONNECT_BASE_MS;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
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
      logger.info(`[worker-agent] 已连接（worker: ${this.workerId}）`);
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
      case 'ping':
        this.send({ type: 'pong' });
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

  private send(msg: object): void {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    } catch {
      // socket 已关闭
    }
  }
}
