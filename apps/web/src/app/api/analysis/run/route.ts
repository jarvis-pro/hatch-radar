import { proxyToServer } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** POST /api/analysis/run —— 代理：手动运行（选中帖子按指定模型入队） */
export async function POST(req: Request) {
  return proxyToServer(req, '/api/analysis/run');
}
