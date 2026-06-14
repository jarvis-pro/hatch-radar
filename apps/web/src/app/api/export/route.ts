import { NextResponse } from 'next/server';
import { serverApiFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** 透传给 server 导出端点的筛选参数（与 shared ExportFilter / server parseExportFilter 对齐） */
const FILTER_KEYS = ['since', 'minIntensity', 'subreddit', 'limit'] as const;

/**
 * GET /api/export —— 流式代理工作台 server 的导出批次下载。
 *
 * - `?format=sqlite`（默认）→ server `GET /api/export/batch.sqlite`（二进制文件流）
 * - `?format=json` → server `GET /api/export/batch`（JSON 批次）
 * - 其余 `since` / `minIntensity` / `subreddit` / `limit` 透传
 *
 * 不复用 lib/proxy 的 proxyToServer：后者把响应体当文本读并强制 application/json，
 * 会损坏 .sqlite 二进制并丢掉 Content-Disposition。这里改为流式透传并保留下载响应头；
 * server 端点的 Bearer 鉴权由 serverApiFetch 在服务端补 token（绝不下发到浏览器）。
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'sqlite';
  const serverPath = format === 'json' ? '/api/export/batch' : '/api/export/batch.sqlite';

  const qs = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) qs.set(key, value);
  }
  const target = qs.toString() ? `${serverPath}?${qs}` : serverPath;

  try {
    const resp = await serverApiFetch(target);
    if (!resp.ok) {
      // server 经全局过滤器返回 { error }；原样透传状态与体
      return new NextResponse(await resp.text(), {
        status: resp.status,
        headers: {
          'content-type': resp.headers.get('content-type') ?? 'application/json; charset=utf-8',
        },
      });
    }
    // 流式透传文件体，保留下载相关响应头
    const headers = new Headers();
    for (const h of ['content-type', 'content-disposition', 'content-length', 'cache-control']) {
      const value = resp.headers.get(h);
      if (value) headers.set(h, value);
    }
    return new NextResponse(resp.body, { status: 200, headers });
  } catch {
    return NextResponse.json(
      {
        error:
          '无法连接工作台 server 进程（默认 http://localhost:47878，可用 SERVER_API_URL 覆盖）',
      },
      { status: 502 },
    );
  }
}
