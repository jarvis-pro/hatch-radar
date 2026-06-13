import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { enqueueManualRun } from '../analysis-config';
import { getJobStats, listRecentJobs } from '../db/jobs';
import { logger } from '../logger';
import { readJsonBody, sendJson } from './http-util';

const runSchema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(500),
  providerId: z.number().int(),
});

/**
 * 处理 /api/analysis/* 路由（鉴权已由 http.ts 在外层完成）。
 *
 * - POST /api/analysis/run    手动运行：选中帖子按指定模型入队（trigger=manual）
 * - GET  /api/analysis/jobs   队列看板：各状态汇总 + 最近任务（供 web 轮询）
 *
 * @returns 是否命中并处理了该路径
 */
export async function handleAnalysisRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/analysis/run' && method === 'POST') {
    let parsed: z.infer<typeof runSchema>;
    try {
      parsed = runSchema.parse(await readJsonBody(req, 256 * 1024));
    } catch (err) {
      sendJson(res, 400, { error: `请求非法：${err instanceof Error ? err.message : '解析失败'}` });
      return true;
    }
    const result = enqueueManualRun(parsed.postIds, parsed.providerId);
    if (!result.ok) {
      sendJson(res, 400, result);
      return true;
    }
    logger.info(`[手动运行] 入队 ${result.enqueued} 篇（provider#${parsed.providerId}）`);
    sendJson(res, 200, result);
    return true;
  }

  if (path === '/api/analysis/jobs' && method === 'GET') {
    sendJson(res, 200, { stats: getJobStats(), jobs: listRecentJobs(50) });
    return true;
  }

  return false;
}
