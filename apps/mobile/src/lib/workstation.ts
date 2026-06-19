import type { CurrentUser, ExportBatch } from '@hatch-radar/shared';
import { getMeta, setMeta } from '../db/schema';
import { buildDeviceHeaders } from './device-identity';

/** 工作台连接配置（保存在本地 meta 表，App 卸载前持久有效） */
export interface WorkstationConfig {
  /** 形如 http://192.168.0.95:8787，不带尾斜杠 */
  baseUrl: string;
}

/** /api/health 的响应结构（server/src/server/http.ts） */
export interface WorkstationHealth {
  ok: boolean;
  now: number;
  stats: { posts: number; comments: number; pendingAnalysis: number; insights: number };
}

const URL_KEY = 'server_url';

export function loadWorkstationConfig(): WorkstationConfig | null {
  const baseUrl = getMeta(URL_KEY);
  if (!baseUrl) return null;
  return { baseUrl };
}

export function saveWorkstationConfig(cfg: WorkstationConfig): void {
  setMeta(URL_KEY, cfg.baseUrl);
}

/** 规整用户输入：补 http://、去尾斜杠与空白 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (!url) throw new Error('请填写工作台地址，例如 http://192.168.0.95:8787');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

/** 带超时的请求（局域网 15s 足够；离线/地址错误时快速失败），统一鉴权与错误文案 */
async function request<T>(cfg: WorkstationConfig, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  // 鉴权恒走设备签名头（未激活返回空头，server 据此拒绝）。
  const deviceHeaders = buildDeviceHeaders(init?.method ?? 'GET', path);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        ...deviceHeaders,
      },
    });
    if (res.status === 401) throw new Error('鉴权失败：请先在「我的」里激活本设备');
    if (!res.ok) throw new Error(`工作台返回 ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('连接超时：请确认与工作台在同一局域网，且 server / pnpm serve 已启动', {
        cause: err,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getJson<T>(cfg: WorkstationConfig, path: string): Promise<T> {
  return request<T>(cfg, path);
}

/** POST JSON（同步推送用） */
export function postJson<T>(cfg: WorkstationConfig, path: string, body: unknown): Promise<T> {
  return request<T>(cfg, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 探测工作台是否可达（不鉴权端点） */
export function fetchHealth(cfg: WorkstationConfig): Promise<WorkstationHealth> {
  return getJson<WorkstationHealth>(cfg, '/api/health');
}

/** 拉取 JSON 批次（当前拉全量有效数据；增量参数留给后续里程碑） */
export function fetchBatch(cfg: WorkstationConfig): Promise<ExportBatch> {
  return getJson<ExportBatch>(cfg, '/api/export/batch');
}

/** 取当前用户态（GET /api/me，设备通道签名鉴权；需已激活并联通工作台）。 */
export async function fetchMe(cfg: WorkstationConfig): Promise<CurrentUser> {
  const { user } = await getJson<{ user: CurrentUser }>(cfg, '/api/me');
  return user;
}

/** 改本人头像（PATCH /api/me/avatar；avatar=所选 DiceBear seed，null 恢复姓名首字母）。 */
export function updateAvatar(cfg: WorkstationConfig, avatar: string | null): Promise<{ ok: true }> {
  return request<{ ok: true }>(cfg, '/api/me/avatar', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ avatar }),
  });
}
