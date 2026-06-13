import 'server-only';

/**
 * 工作台 server 进程的 HTTP 地址。写操作（模型设置、分析运行）与配置读取经此转发——
 * web 自身只读库、绝不写库，写入与密钥统一发生在 server 进程（见 lib/db.ts）。
 */
const SERVER_API_URL = process.env.SERVER_API_URL?.trim() || 'http://localhost:8787';
/** 可选访问令牌；server 设了 API_TOKEN 时，web 也须配同值。仅在服务端读取，不进客户端 bundle */
const API_TOKEN = process.env.API_TOKEN?.trim();

/**
 * 向工作台 server 进程转发请求（在 web 的 route handler 内服务端调用）。
 * - 自动补全 base URL 与可选的 Bearer Token，禁用缓存
 * @param path 以 `/` 开头的 server 端点路径
 * @param init 透传给 fetch 的选项
 * @returns server 的原始响应（由调用方决定如何回传）
 */
export function serverApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (API_TOKEN) headers.set('authorization', `Bearer ${API_TOKEN}`);
  return fetch(`${SERVER_API_URL}${path}`, { ...init, headers, cache: 'no-store' });
}
