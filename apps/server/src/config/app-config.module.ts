import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_ENV } from '../common/tokens';
import { loadEnv, type AppEnv } from './env';

/**
 * 全局配置模块。
 *
 * - 接入 `@nestjs/config` 完成 .env 文件加载，并把现有 env.ts 的 zod 校验作为 `validate`
 *   注入——启动时一次性校验，配置非法直接 fail（与裸跑时一致的早失败语义）。
 * - 以 {@link APP_ENV} 令牌提供结构化 AppEnv，业务侧 `@Inject(APP_ENV)` 取强类型配置。
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // 用 zod schema 校验整份 env；返回结构化 AppEnv 作为校验后的配置
      validate: () => loadEnv(),
    }),
  ],
  providers: [{ provide: APP_ENV, useFactory: (): AppEnv => loadEnv() }],
  exports: [APP_ENV],
})
export class AppConfigModule {}
