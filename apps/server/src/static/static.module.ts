import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type DynamicModule, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { logger } from '@/logger';

/** SPA 构建产物目录：默认 ../web/dist（相对 server cwd），可经 WEB_DIST_DIR 覆盖（Docker 单一部署物）。 */
function webDistDir(): string {
  return process.env.WEB_DIST_DIR?.trim() || resolve(process.cwd(), '../web/dist');
}

/**
 * 同源托管 SPA（后端归一 + 前端 SPA 迁移）：NestJS 既发 `/api`，又发 Vite 构建的静态产物，
 * 非 `/api` 未命中回 index.html（前端深链刷新由 React Router 客户端接管）。
 *
 * 仅当产物存在时启用（dev 走 Vite dev server + proxy、test 无产物，此处空载不报错）。
 * `exclude` 保证 `/api/*` 与 `/ws/*` 不被静态回退劫持。
 */
@Module({})
export class StaticModule {
  static forRoot(): DynamicModule {
    const dir = webDistDir();
    const hasBuild = existsSync(resolve(dir, 'index.html'));
    if (!hasBuild) {
      logger.info(`[static] 未发现 SPA 产物（${dir}），跳过同源托管（dev 走 Vite proxy）`);
      return { module: StaticModule, imports: [] };
    }
    logger.info(`[static] 同源托管 SPA：${dir}`);
    return {
      module: StaticModule,
      imports: [
        ServeStaticModule.forRoot({
          rootPath: dir,
          exclude: ['/api/{*path}', '/ws/{*path}'],
          serveStaticOptions: { index: ['index.html'] },
        }),
      ],
    };
  }
}
