import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { nowSec } from '@/utils/time';
import { JobsRepository } from '@/db/jobs.repository';
import { logger } from '@/logger';

interface WorkerState {
  workerId: string;
  socket: WebSocket;
  concurrency: number;
  activeJobs: number;
  cpu: number;
  memory: number;
  lastHeartbeat: number;
}

type WorkerMessage =
  | { type: 'register'; workerId: string; concurrency: number }
  | { type: 'heartbeat'; workerId: string; cpu: number; memory: number; activeJobs: number }
  | {
      type: 'job_result';
      workerId: string;
      jobId: number;
      status: 'succeeded' | 'failed';
      error?: string;
    }
  | { type: 'job_progress'; workerId: string; jobId: number };

/** worker 心跳超过此时长无响应则从注册表驱逐 */
const WORKER_EVICT_MS = 30_000;
/** 驱逐检查周期 */
const EVICT_INTERVAL_MS = 15_000;
/** 兜底分发周期：防止通知遗漏时队列积压 */
const FALLBACK_DISPATCH_INTERVAL_MS = 10_000;

/**
 * Push 网关：维护 worker 注册表，负责认领任务并主动分发给最优 worker。
 *
 * WS 服务器附加在既有 HTTP 服务器上（同端口 /ws/worker），无需新开端口。
 * worker 注册表存内存，网关重启后 worker 重连即自动重建。
 * 兜底分发定时器保证即便通知遗漏，任务最终也会被派出。
 */
@Injectable()
export class GatewayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private wsServer!: WebSocketServer;
  /** workerId → state */
  private readonly registry = new Map<string, WorkerState>();
  /** socket → workerId（反向索引，断连时用） */
  private readonly socketToId = new Map<WebSocket, string>();
  private evictTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly jobs: JobsRepository,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.wsServer = new WebSocketServer({ server: httpServer, path: '/ws/worker' });
    this.wsServer.on('connection', (ws: WebSocket, _req: IncomingMessage) => this.onConnect(ws));
    this.evictTimer = setInterval(() => this.evictStale(), EVICT_INTERVAL_MS);
    this.fallbackTimer = setInterval(() => void this.tryDispatch(), FALLBACK_DISPATCH_INTERVAL_MS);
    logger.info('[gateway] WebSocket 服务已启动（路径: /ws/worker）');
  }

  onApplicationShutdown(): void {
    if (this.evictTimer) clearInterval(this.evictTimer);
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.wsServer?.close();
  }

  /** 供 AnalysisConfigService 在入队后立即触发一次分发 */
  async tryDispatch(): Promise<void> {
    const worker = this.pickWorker();
    if (!worker) return;
    const job = await this.jobs.claimNextJob(nowSec());
    if (!job) return;
    worker.activeJobs++;
    this.send(worker.socket, {
      type: 'dispatch',
      jobId: job.id,
      postId: job.post_id,
      providerId: job.provider_id,
      model: job.model,
    });
    logger.info(`[gateway] 分发 job#${job.id} → ${worker.workerId}`);
  }

  /** 当前在线 worker 概况（供日志 / 诊断） */
  get workerCount(): number {
    return this.registry.size;
  }

  private onConnect(ws: WebSocket): void {
    ws.on('message', (raw) => {
      let msg: WorkerMessage;
      try {
        msg = JSON.parse(raw.toString()) as WorkerMessage;
      } catch {
        return;
      }
      void this.handle(ws, msg);
    });
    ws.on('close', () => this.onDisconnect(ws));
    ws.on('error', (err) => {
      logger.warn(`[gateway] worker socket 错误: ${err.message}`);
    });
  }

  private onDisconnect(ws: WebSocket): void {
    const workerId = this.socketToId.get(ws);
    if (!workerId) return;
    this.socketToId.delete(ws);
    this.registry.delete(workerId);
    logger.warn(`[gateway] worker 断连: ${workerId}`);
    // 遗留 running 任务由 WorkerService 的僵死回收机制（heartbeat 超时）兜底
  }

  private async handle(ws: WebSocket, msg: WorkerMessage): Promise<void> {
    switch (msg.type) {
      case 'register': {
        const state: WorkerState = {
          workerId: msg.workerId,
          socket: ws,
          concurrency: msg.concurrency,
          activeJobs: 0,
          cpu: 0,
          memory: 0,
          lastHeartbeat: Date.now(),
        };
        this.registry.set(msg.workerId, state);
        this.socketToId.set(ws, msg.workerId);
        this.send(ws, { type: 'registered', workerId: msg.workerId });
        logger.info(`[gateway] worker 注册: ${msg.workerId}（并发上限 ${msg.concurrency}）`);
        await this.tryDispatch();
        break;
      }
      case 'heartbeat': {
        const s = this.registry.get(msg.workerId);
        if (s) {
          s.cpu = msg.cpu;
          s.memory = msg.memory;
          s.activeJobs = msg.activeJobs;
          s.lastHeartbeat = Date.now();
        }
        break;
      }
      case 'job_result': {
        const s = this.registry.get(msg.workerId);
        if (s) {
          s.activeJobs = Math.max(0, s.activeJobs - 1);
          s.lastHeartbeat = Date.now();
        }
        logger.info(`[gateway] job#${msg.jobId} 完成（${msg.status}）← ${msg.workerId}`);
        await this.tryDispatch();
        break;
      }
      case 'job_progress': {
        // worker 仍在运行，更新 DB 心跳防僵死回收
        await this.jobs.touchHeartbeat(msg.jobId, nowSec());
        break;
      }
    }
  }

  private pickWorker(): WorkerState | null {
    const available = [...this.registry.values()].filter(
      (w) => w.activeJobs < w.concurrency && w.socket.readyState === WebSocket.OPEN,
    );
    if (!available.length) return null;
    available.sort((a, b) => {
      if (a.activeJobs !== b.activeJobs) return a.activeJobs - b.activeJobs;
      if (a.cpu !== b.cpu) return a.cpu - b.cpu;
      return a.memory - b.memory;
    });
    return available[0]!;
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [id, state] of this.registry) {
      if (now - state.lastHeartbeat > WORKER_EVICT_MS) {
        this.registry.delete(id);
        this.socketToId.delete(state.socket);
        logger.warn(`[gateway] 驱逐超时 worker: ${id}`);
      }
    }
  }

  private send(ws: WebSocket, msg: object): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    } catch {
      // socket 已关闭
    }
  }
}
