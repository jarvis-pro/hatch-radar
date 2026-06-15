import { Module } from '@nestjs/common';
import { GatewayStarter } from './gateway.starter';

/**
 * Push 网关模块：HTTP 进程中运行,维护 worker 注册表并主动分发任务。
 * GatewayService 本体在 @hatch-radar/core（CoreModule 全局提供）；本模块只放 Nest 生命周期薄封装
 * GatewayStarter（onApplicationBootstrap 里把网关挂上 http.Server）。
 */
@Module({
  providers: [GatewayStarter],
})
export class GatewayModule {}
