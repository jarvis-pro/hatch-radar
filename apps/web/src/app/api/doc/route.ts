import { NextResponse } from 'next/server';
import { serverApiFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doc?postId=... —— 代理：取单篇帖子的待分析 Markdown 文档，供前端一键复制。
 */
export async function GET(req: Request) {
  const postId = new URL(req.url).searchParams.get('postId');
  if (!postId) return NextResponse.json({ error: '缺少 postId' }, { status: 400 });
  try {
    const resp = await serverApiFetch(`/api/posts/${encodeURIComponent(postId)}/doc`);
    return new NextResponse(await resp.text(), {
      status: resp.status,
      headers: {
        'content-type': resp.headers.get('content-type') ?? 'text/markdown; charset=utf-8',
      },
    });
  } catch {
    return NextResponse.json(
      { error: '无法连接工作台 server 进程（默认 http://localhost:8787，可用 SERVER_API_URL 覆盖）' },
      { status: 502 },
    );
  }
}
