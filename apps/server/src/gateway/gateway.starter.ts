import type { Server as HttpServer } from 'node:http';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { GatewayService } from '@hatch-radar/core';

/**
 * Nest 侧网关薄封装：把 core 的 GatewayService（push 派发,维护 worker 注册表）挂到既有 HTTP 服务器
 * （同端口 /ws/worker）。取底层 http.Server 用 NestJS 的 HttpAdapterHost（对应 Midway 的 framework.getServer）。
 */
@Injectable()
export class GatewayStarter implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly gateway: GatewayService,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.gateway.start(server);
  }

  onApplicationShutdown(): void {
    this.gateway.stop();
  }
}
