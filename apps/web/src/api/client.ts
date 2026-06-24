/**
 * 同源 API 客户端：所有请求打到 `/api/*`（dev 经 Vite proxy、prod 由 NestJS 同源托管）。
 * token 存于 localStorage，每次请求经 Authorization: Bearer 头携带。
 *
 * 401 统一交给注册的处理器（AuthProvider → 置匿名 → 路由守卫跳 /login），
 * 唯独会话自检（skipAuthHandler）只抛不触发，避免登录页/启动自检的重定向自循环。
 */

const API_BASE = '/api';
const TOKEN_KEY = 'radar_token';

/** API 错误：带 HTTP 状态码与 server 返回的 { error } 文案。 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 读取本地持久化的会话 token。 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** 持久化或清除会话 token（null = 清除）。 */
export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** 注册全局 401 处理器（AuthProvider 调用，置为匿名态）。 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

interface RequestOptions {
  /** 会话自检用：401 只抛错，不触发全局处理器（避免重定向自循环）。 */
  skipAuthHandler?: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    if (!opts?.skipAuthHandler) {
      unauthorizedHandler?.();
    }

    throw new ApiError(401, await errorMessage(res, '未登录或会话已过期'));
  }

  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res, res.statusText));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();

  return (text ? JSON.parse(text) : undefined) as T;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };

    return data?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PATCH', path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PUT', path, body, opts),
  del: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('DELETE', path, body, opts),
};

/**
 * 导出下载：流式拿 blob（保留 .sqlite 等二进制），自带 Bearer token。
 * @param fallbackName Content-Disposition 缺失时（如 JSON 批次）使用的文件名
 * @returns blob 与文件名（优先取 Content-Disposition）
 */
export async function downloadBlob(
  path: string,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401) {
    unauthorizedHandler?.();
    throw new ApiError(401, '未登录或会话已过期');
  }

  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res, res.statusText));
  }

  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);

  return { blob, filename: match?.[1] ?? fallbackName };
}
