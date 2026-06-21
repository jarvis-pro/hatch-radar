import 'reflect-metadata';
import { networkInterfaces } from 'node:os';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { type AppEnv, logger } from '@/domain';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { APP_ENV } from './common/tokens';

/** 枚举本机非回环 IPv4 地址，方便在手机上直接填写 */
function lanAddresses(): string[] {
  const result: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) result.push(iface.address);
    }
  }
  return result;
}

/**
 * 后端唯一进程入口（`pnpm start:api`）—— 单实例。
 *
 * 以 NestExpressApplication 引导：HTTP 监听（/api）+ @Cron 调度 + 内嵌任务执行
 * （经 PG 持久化队列 + LocalDispatcher 进程内认领）+ 同源托管 web SPA。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  // 同步推送上限：outbox 操作很小，5MB 足够容纳上万条（对应裸跑实现）
  app.useBodyParser('json', { limit: '5mb' });
  app.useGlobalFilters(new AllExceptionsFilter());
  // 统一 API 前缀：控制器只声明各自子路径，外部路径仍为 /api/*（mobile / web 契约不变）
  app.setGlobalPrefix('api');
  // 优雅退出：触发各 service 的 OnApplicationShutdown（worker 排空、连接池关闭）
  app.enableShutdownHooks();

  const env = app.get<AppEnv>(APP_ENV);
  // 绑 0.0.0.0：监听本机所有网卡，使本进程同时经 localhost 与局域网 IP 可达。
  // web（同源托管的 SPA + /api）与 mobile 共用这一监听；只是 mobile 必须走局域网 IP
  // （手机是 LAN 上的另一台设备），故不能只绑回环——这才是对外开放的原因。
  // 网络位置不参与鉴权：恒开、fail-closed——人=会话 cookie、mobile=设备签名，守卫一处校验。
  await app.listen(env.http.port, '0.0.0.0');

  logger.info('服务已启动（端口 %d，鉴权恒开：会话 / 设备签名）', env.http.port);
  for (const ip of lanAddresses()) {
    logger.info('  · 局域网地址: http://%s:%d', ip, env.http.port);
  }
}

bootstrap().catch((err: unknown) => {
  logger.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
