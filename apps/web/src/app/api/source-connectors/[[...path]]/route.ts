import { proxyToServer } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path?: string[] }> };

/** 把 web 的 /api/source-connectors/* 映射为 server 的同名路径（含查询串） */
async function target(req: Request, ctx: Ctx): Promise<string> {
  const { path } = await ctx.params;
  const sub = path && path.length > 0 ? `/${path.join('/')}` : '';
  const search = new URL(req.url).search;
  return `/api/source-connectors${sub}${search}`;
}

export async function GET(req: Request, ctx: Ctx) {
  return proxyToServer(req, await target(req, ctx));
}
export async function POST(req: Request, ctx: Ctx) {
  return proxyToServer(req, await target(req, ctx));
}
export async function PUT(req: Request, ctx: Ctx) {
  return proxyToServer(req, await target(req, ctx));
}
export async function DELETE(req: Request, ctx: Ctx) {
  return proxyToServer(req, await target(req, ctx));
}
