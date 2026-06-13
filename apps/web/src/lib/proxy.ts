import { NextResponse } from 'next/server';
import { serverApiFetch } from './server-api';

/**
 * 把当前请求转发给工作台 server 进程，并原样回传其响应（JSON）。
 * - 自动透传方法与请求体；GET/HEAD 不带体
 * - serverApiFetch 负责补 base URL 与可选 Bearer Token
 * - server 不可达时回 502，与既有 /api/import 代理一致
 * @param req web 收到的请求
 * @param serverPath 目标 server 路径（含查询串），如 `/api/settings/providers`
 */
export async function proxyToServer(req: Request, serverPath: string): Promise<NextResponse> {
  const method = req.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? await req.text() : undefined;
  try {
    const resp = await serverApiFetch(serverPath, {
      method,
      headers: hasBody ? { 'content-type': 'application/json' } : undefined,
      body,
    });
    return new NextResponse(await resp.text(), {
      status: resp.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
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
