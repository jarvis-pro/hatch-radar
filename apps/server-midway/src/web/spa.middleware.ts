import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Middleware, type IMiddleware } from '@midwayjs/core';
import type { Context, NextFunction } from '@midwayjs/koa';
import { logger } from '@/logger';

/** SPA 构建产物目录：默认 ../web/dist（相对 cwd），可经 WEB_DIST_DIR 覆盖。 */
function webDistDir(): string {
  return process.env.WEB_DIST_DIR?.trim() || resolve(process.cwd(), '../web/dist');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 同源托管 SPA（对应 NestJS 版 StaticModule + @nestjs/serve-static）：
 * 既发 /api，又发 Vite 构建产物，非 /api 未命中回 index.html（React Router 深链）。
 * `/api`、`/ws` 一律放行给路由（对应 serve-static 的 exclude）。
 * 仅当产物存在时启用；dev/test 无产物时空载放行（与 NestJS 版一致，走 Vite proxy）。
 */
@Middleware()
export class SpaMiddleware implements IMiddleware<Context, NextFunction> {
  private readonly dir = webDistDir();
  private readonly hasBuild = existsSync(resolve(this.dir, 'index.html'));

  constructor() {
    if (this.hasBuild) {
      logger.info(`[static] 同源托管 SPA：${this.dir}`);
    } else {
      logger.info(`[static] 未发现 SPA 产物（${this.dir}），跳过同源托管（dev 走 Vite proxy）`);
    }
  }

  resolve() {
    return async (ctx: Context, next: NextFunction): Promise<unknown> => {
      if (!this.hasBuild) return next();
      if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next();
      const p = ctx.path;
      if (p.startsWith('/api') || p.startsWith('/ws')) return next();

      // 防目录穿越：归一化后裁掉前导 ../
      const rel = normalize(p).replace(/^(\.\.[/\\])+/, '');
      const filePath = join(this.dir, rel);
      const isFile =
        filePath.startsWith(this.dir) && existsSync(filePath) && statSync(filePath).isFile();
      const target = isFile ? filePath : join(this.dir, 'index.html'); // 深链回退 index.html
      ctx.set('Content-Type', MIME[extname(target).toLowerCase()] ?? 'application/octet-stream');
      ctx.body = createReadStream(target);
      return undefined;
    };
  }

  static getName(): string {
    return 'spa';
  }
}
