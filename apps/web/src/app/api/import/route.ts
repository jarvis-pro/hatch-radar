import { NextResponse } from 'next/server';
import { serverApiFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/import —— 代理：把洞察回灌请求转发给工作台 server 进程。
 * web 不直接写库；落库在 server 进程完成，避免与爬虫抢写锁。
 */
export async function POST(req: Request) {
  const body = await req.text();
  try {
    const resp = await serverApiFetch('/api/insights/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    return new NextResponse(await resp.text(), {
      status: resp.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch {
    return NextResponse.json(
      { error: '无法连接工作台 server 进程（默认 http://localhost:8787，可用 SERVER_API_URL 覆盖）' },
      { status: 502 },
    );
  }
}
