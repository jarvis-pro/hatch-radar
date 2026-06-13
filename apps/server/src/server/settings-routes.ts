import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { enqueueAutoAnalysisRound, reloadAnalysisConfig, testProvider } from '../analysis-config';
import { isSecretConfigured } from '../crypto';
import {
  createProvider,
  deleteProvider,
  getProvider,
  listProviders,
  toProviderDTO,
  updateProvider,
  type ProviderInput,
} from '../db/providers';
import { getActiveProviderId, setActiveProviderId } from '../db/settings';
import { nowSec } from '../db/utils';
import { readJsonBody, sendJson } from './http-util';
import { logger } from '../logger';

const providerKind = z.enum(['anthropic', 'openai', 'deepseek']);

const createSchema = z.object({
  provider: providerKind,
  label: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  baseUrl: z.string().trim().optional(),
  model: z.string().trim().min(1),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  provider: providerKind.optional(),
  label: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  model: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
});

const activeSchema = z.object({ providerId: z.number().int().nullable() });

/** '' / 仅空白的 baseUrl 归一化为 undefined（不存空串） */
function normalizeBaseUrl(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * 处理 /api/settings/* 路由（鉴权已由 http.ts 在外层完成）。
 *
 * 端点：
 * - GET    /api/settings                     概览：providers（脱敏）+ activeProviderId + secretConfigured
 * - GET    /api/settings/providers           模型清单（脱敏）
 * - POST   /api/settings/providers           新建模型（密钥加密入库）
 * - PUT    /api/settings/providers/:id        更新模型（apiKey 留空则保留原值）
 * - DELETE /api/settings/providers/:id        删除模型（若为 active 则同时清空 active）
 * - PUT    /api/settings/active               选用模型 { providerId: number|null }，即时热重载并触发一轮入队
 *
 * 任意写操作后调用 reloadAnalysisConfig() 使配置即时生效（无需重启进程）。
 * @returns 是否命中并处理了该路径
 */
export async function handleSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/settings' && method === 'GET') {
    sendJson(res, 200, {
      providers: listProviders().map(toProviderDTO),
      activeProviderId: getActiveProviderId(),
      secretConfigured: isSecretConfigured(),
    });
    return true;
  }

  if (path === '/api/settings/providers' && method === 'GET') {
    sendJson(res, 200, listProviders().map(toProviderDTO));
    return true;
  }

  if (path === '/api/settings/providers' && method === 'POST') {
    if (!isSecretConfigured()) {
      sendJson(res, 400, { error: '未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置' });
      return true;
    }
    let parsed: z.infer<typeof createSchema>;
    try {
      parsed = createSchema.parse(await readJsonBody(req));
    } catch (err) {
      sendJson(res, 400, { error: `请求非法：${err instanceof Error ? err.message : '解析失败'}` });
      return true;
    }
    const input: ProviderInput = { ...parsed, baseUrl: normalizeBaseUrl(parsed.baseUrl) };
    const id = createProvider(input, nowSec());
    reloadAnalysisConfig();
    logger.info(`[设置] 新增模型 #${id}：${parsed.provider} (${parsed.model})`);
    sendJson(res, 201, { id });
    return true;
  }

  const providerIdMatch = path.match(/^\/api\/settings\/providers\/(\d+)$/);
  if (providerIdMatch) {
    const id = Number(providerIdMatch[1]);
    if (method === 'PUT') {
      let parsed: z.infer<typeof updateSchema>;
      try {
        parsed = updateSchema.parse(await readJsonBody(req));
      } catch (err) {
        sendJson(res, 400, {
          error: `请求非法：${err instanceof Error ? err.message : '解析失败'}`,
        });
        return true;
      }
      if (parsed.apiKey && !isSecretConfigured()) {
        sendJson(res, 400, { error: '未配置 SETTINGS_SECRET，无法加密新密钥' });
        return true;
      }
      const fields: Partial<ProviderInput> = { ...parsed };
      if (parsed.baseUrl !== undefined) fields.baseUrl = normalizeBaseUrl(parsed.baseUrl);
      const ok = updateProvider(id, fields, nowSec());
      if (!ok) {
        sendJson(res, 404, { error: '模型配置不存在或无字段可更新' });
        return true;
      }
      reloadAnalysisConfig();
      logger.info(`[设置] 更新模型 #${id}`);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === 'DELETE') {
      const removed = deleteProvider(id);
      if (!removed) {
        sendJson(res, 404, { error: '模型配置不存在' });
        return true;
      }
      if (getActiveProviderId() === id) setActiveProviderId(null);
      reloadAnalysisConfig();
      logger.info(`[设置] 删除模型 #${id}`);
      sendJson(res, 200, { ok: true });
      return true;
    }
    sendJson(res, 405, { error: 'method not allowed' });
    return true;
  }

  const testMatch = path.match(/^\/api\/settings\/providers\/(\d+)\/test$/);
  if (testMatch && method === 'POST') {
    const result = await testProvider(Number(testMatch[1]));
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (path === '/api/settings/active' && method === 'PUT') {
    let parsed: z.infer<typeof activeSchema>;
    try {
      parsed = activeSchema.parse(await readJsonBody(req));
    } catch (err) {
      sendJson(res, 400, { error: `请求非法：${err instanceof Error ? err.message : '解析失败'}` });
      return true;
    }
    if (parsed.providerId !== null) {
      const row = getProvider(parsed.providerId);
      if (!row) {
        sendJson(res, 404, { error: '模型配置不存在' });
        return true;
      }
      if (row.enabled !== 1) {
        sendJson(res, 400, { error: '该模型已停用，无法设为 active' });
        return true;
      }
    }
    setActiveProviderId(parsed.providerId);
    reloadAnalysisConfig();
    // 即时生效：选用后立刻入一轮队，无需等下一次定时调度
    const round = enqueueAutoAnalysisRound();
    logger.info(
      `[设置] active 模型 → ${parsed.providerId ?? '（清空）'}；即时入队 ${round.enqueued} 篇`,
    );
    sendJson(res, 200, { activeProviderId: parsed.providerId, enqueued: round.enqueued });
    return true;
  }

  return false;
}
