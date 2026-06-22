import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@/app.module';
import { SessionsRepository, UsersRepository, type DbHandle } from '@/database';
import { generateSessionToken, hashSessionToken } from '@/auth';
import { nowSec } from '@/utils/time';
import { setupTestDb, truncateAll, TEST_DATABASE_URL } from './helpers';

/**
 * 鉴权契约 e2e：引导**真实 AppModule** 并走 HTTP（Node 内置 fetch，无需 supertest），
 * 覆盖此前完全没有的层——SessionAuthGuard / CSRF 兜底 / 能力闸 / 全局异常过滤器 / DI 装配。
 * 是 A/B/H 等重构的安全网：鉴权链一旦回归，这里立刻变红。
 */
const ADMIN_EMAIL = 'e2e-admin@test.co';
const ADMIN_PASS = 'e2e-pass-12345';

interface CallOpts {
  cookie?: string;
  csrf?: boolean;
  body?: unknown;
}

describe('鉴权契约 e2e（真实 AppModule + HTTP）', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let base = '';

  beforeAll(async () => {
    // env 必须在 AppConfigModule.loadEnv（compile 时）之前就位
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.SETTINGS_SECRET ||= 'e2e-secret-0123456789abcdef';
    process.env.SUPER_ADMIN_EMAIL = ADMIN_EMAIL;
    process.env.SUPER_ADMIN_PASSWORD = ADMIN_PASS;

    handle = setupTestDb();
    await truncateAll(handle.db); // 清空 → 让 super-admin 种子生效，且无遗留任务被泵执行

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // 对齐 main.ts；APP_FILTER 由 AppModule 装配，无需手动注册
    app.enableShutdownHooks();
    await app.listen(0); // 随机端口（测试串行，无冲突）；onApplicationBootstrap 跑种子
    const addr = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await app?.close(); // 停 worker 泵 / 调度 cron、关连接池
    await handle?.close();
  });

  function call(method: string, path: string, opts: CallOpts = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.cookie) headers['cookie'] = opts.cookie;
    if (opts.csrf) headers['x-radar-csrf'] = '1';
    return fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  let cookie = '';

  it('未带 cookie 访问受保护端点 → 401', async () => {
    const r = await call('GET', '/api/auth/session');
    expect(r.status).toBe(401);
  });

  it('凭据错误 → 401（不泄露存在性）', async () => {
    const r = await call('POST', '/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: 'wrong-password' },
    });
    expect(r.status).toBe(401);
  });

  it('登录成功 → 200 + Set-Cookie radar_session', async () => {
    const r = await call('POST', '/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASS },
    });
    expect(r.status).toBe(200);
    const setCookie = r.headers.get('set-cookie') ?? '';
    const m = /radar_session=([^;]+)/.exec(setCookie);
    expect(m).not.toBeNull();
    cookie = `radar_session=${m![1]}`;
    expect(((await r.json()) as { user: { email: string } }).user.email).toBe(ADMIN_EMAIL);
  });

  it('带有效 cookie 访问受保护端点 → 200', async () => {
    const r = await call('GET', '/api/auth/session', { cookie });
    expect(r.status).toBe(200);
  });

  it('写方法缺 X-Radar-Csrf 头 → 403（CSRF 兜底，先于处理器）', async () => {
    const r = await call('POST', '/api/auth/logout', { cookie });
    expect(r.status).toBe(403);
  });

  it('写方法带 X-Radar-Csrf 头 → 放行（200）', async () => {
    const r = await call('POST', '/api/auth/logout', { cookie, csrf: true });
    expect(r.status).toBe(200);
  });

  it('能力不足 → 403（权限闸）', async () => {
    // 直接种一个无 settings:manage 的普通管理员 + 会话，访问需该能力的端点
    const users = app.get(UsersRepository);
    const sessions = app.get(SessionsRepository);
    const now = nowSec();
    const userId = await users.create(
      {
        email: 'limited@test.co',
        name: '受限管理员',
        passwordHash: 'unused',
        role: 'admin',
        mustChangePassword: false,
        createdBy: null,
        permissions: [],
        grantedBy: null,
      },
      now,
    );
    const token = generateSessionToken();
    await sessions.create({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: now + 86_400,
      lastSeenAt: now,
      createdAt: now,
      userAgent: null,
      ip: null,
    });
    const r = await call('GET', '/api/settings', { cookie: `radar_session=${token}` });
    expect(r.status).toBe(403);
  });

  it('无效 cookie → 401', async () => {
    const r = await call('GET', '/api/auth/session', { cookie: 'radar_session=bogus-token' });
    expect(r.status).toBe(401);
  });
});
