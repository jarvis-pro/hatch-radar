import { NextResponse } from 'next/server';
import { serverApiFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/export-lock —— 代理：把「冻结选中导出帖」转发给工作台 server 进程。
 * 冻结是写操作，仍发生在 server 进程（web 不直接写库）。
 */
export async function POST(req: Request) {
  const body = await req.text();
  try {
    const resp = await serverApiFetch('/api/export/lock', {
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
