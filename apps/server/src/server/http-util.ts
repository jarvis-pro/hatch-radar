import type { IncomingMessage, ServerResponse } from 'node:http';

/** 统一的 JSON 响应（禁用缓存） */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/**
 * 读取并解析 JSON 请求体（带大小上限）。
 * @param req 请求
 * @param maxBytes 上限字节数，默认 64KB
 * @throws body 超限或非合法 JSON 时抛出
 */
export async function readJsonBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
