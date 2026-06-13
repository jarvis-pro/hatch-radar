import 'server-only';
import { webEnv } from './env';

/**
 * 向工作台 server 进程转发请求（在 web 的 route handler 内服务端调用）。
 *
 * 写操作（模型设置、分析运行）与配置读取经此转发——web 自身只读库、绝不写库，
 * 写入与密钥统一发生在 server 进程（见 lib/db.ts）。地址与可选 Token 取自校验后的
 * web env 切片（默认值来自 @hatch-radar/config）。
 * @param path 以 `/` 开头的 server 端点路径
 * @param init 透传给 fetch 的选项
 * @returns server 的原始响应（由调用方决定如何回传）
 */
export function serverApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const { serverApiUrl, apiToken } = webEnv();
  const headers = new Headers(init?.headers);
  if (apiToken) headers.set('authorization', `Bearer ${apiToken}`);
  return fetch(`${serverApiUrl}${path}`, { ...init, headers, cache: 'no-store' });
}
