import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExportFilter, Intensity } from '@hatch-radar/shared';
import { getStats, nowSec } from '../db/utils';
import { collectExportBatch, defaultExportName, writeBatchSqlite } from '../export/batch';
import { logger } from '../logger';

/** HTTP 服务配置（env 推导） */
export interface HttpConfig {
  /** 监听端口；绑定 0.0.0.0 供局域网内的移动端访问 */
  port: number;
  /** 可选访问令牌；设置后导出接口要求 `Authorization: Bearer <token>` */
  token?: string;
}

/** 解析查询串中的批次筛选条件；非法值按未提供处理 */
function parseExportFilter(url: URL): ExportFilter {
  const filter: ExportFilter = {};
  const since = Number(url.searchParams.get('since'));
  if (Number.isInteger(since) && since > 0) filter.since = since;
  const limit = Number(url.searchParams.get('limit'));
  if (Number.isInteger(limit) && limit > 0) filter.limit = limit;
  const intensity = url.searchParams.get('minIntensity')?.toUpperCase();
  if (intensity === 'HIGH' || intensity === 'MEDIUM' || intensity === 'LOW') {
    filter.minIntensity = intensity as Intensity;
  }
  const subreddit = url.searchParams.get('subreddit')?.trim();
  if (subreddit) filter.subreddit = subreddit;
  return filter;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** 校验 Bearer Token；未配置 token 时直接放行（局域网信任模式） */
function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

/**
 * GET /api/export/batch.sqlite —— 先在临时目录落一个独立 .sqlite，流式发给客户端后清理。
 * 文件不开 WAL（见 writeBatchSqlite），单文件即完整批次。
 */
function handleSqliteDownload(res: ServerResponse, filter: ExportFilter): void {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-radar-export-'));
  const name = defaultExportName('sqlite');
  const file = writeBatchSqlite(collectExportBatch(filter), join(dir, name));
  const { size } = statSync(file);
  res.writeHead(200, {
    'content-type': 'application/vnd.sqlite3',
    'content-length': size,
    'content-disposition': `attachment; filename="${name}"`,
    'cache-control': 'no-store',
  });
  const stream = createReadStream(file);
  stream.pipe(res);
  stream.on('close', () => rmSync(dir, { recursive: true, force: true }));
  stream.on('error', () => {
    rmSync(dir, { recursive: true, force: true });
    res.destroy();
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse, cfg: HttpConfig): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  // 健康检查不鉴权：供 App 在局域网内探测工作台
  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, now: nowSec(), stats: getStats() });
    return;
  }

  if (url.pathname === '/api/export/batch' || url.pathname === '/api/export/batch.sqlite') {
    if (!authorized(req, cfg.token)) {
      sendJson(res, 401, { error: 'unauthorized：请携带 Authorization: Bearer <EXPORT_TOKEN>' });
      return;
    }
    const filter = parseExportFilter(url);
    if (url.pathname === '/api/export/batch.sqlite') {
      handleSqliteDownload(res, filter);
    } else {
      const batch = collectExportBatch(filter);
      logger.info(
        `[导出] HTTP 批次：洞察 ${batch.meta.counts.insights} / 帖子 ${batch.meta.counts.posts} / 评论 ${batch.meta.counts.comments}`,
      );
      sendJson(res, 200, batch);
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

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
 * 启动局域网导出 HTTP 服务（绑定 0.0.0.0）。
 *
 * 端点：
 * - GET /api/health                 健康检查 + 数据概览（不鉴权）
 * - GET /api/export/batch           JSON 批次；查询参数 since / minIntensity / subreddit / limit
 * - GET /api/export/batch.sqlite    同条件的独立 .sqlite 文件下载
 *
 * 仅做局域网内的数据下行，AI 密钥与写操作不经过此服务。
 */
export function startHttpServer(cfg: HttpConfig): Server {
  const server = createServer((req, res) => {
    try {
      handleRequest(req, res, cfg);
    } catch (err) {
      logger.error(`[导出] HTTP 处理失败: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.destroy();
    }
  });
  server.listen(cfg.port, '0.0.0.0', () => {
    const urls = lanAddresses().map((ip) => `http://${ip}:${cfg.port}`);
    logger.info(`导出服务已启动（端口 ${cfg.port}${cfg.token ? '，已启用 Token 鉴权' : ''}）`);
    for (const u of urls) logger.info(`  · 局域网地址: ${u}`);
  });
  return server;
}
