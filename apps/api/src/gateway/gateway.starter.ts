import type { Server as HttpServer } from 'node:http';
import {
  type BeforeApplicationShutdown,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { GatewayService } from '@/domain';

/**
 * Nest 侧网关薄封装：把 core 的 GatewayService（push 派发,维护 worker 注册表）挂到既有 HTTP 服务器
 * （同端口 /ws/worker）。取底层 http.Server 用 NestJS 的 HttpAdapterHost（对应 Midway 的 framework.getServer）。
 *
 * 关停挂在 beforeApplicationShutdown 而非 onApplicationShutdown：NestJS 关停顺序为
 * beforeApplicationShutdown → dispose(关 HTTP 服务器) → onApplicationShutdown。WS 是 HTTP 服务器上的长连接，
 * dispose 会等其断开；若拖到 onApplicationShutdown 再断 socket 就死锁（关 http 等 WS、断 WS 等关 http）。
 * 故必须早于 dispose 主动断开（见 GatewayService.stop）。
 */
@Injectable()
export class GatewayStarter implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly gateway: GatewayService,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.gateway.start(server);
  }

  beforeApplicationShutdown(): void {
    this.gateway.stop();
  }
}
