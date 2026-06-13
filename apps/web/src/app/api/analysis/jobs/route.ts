import { proxyToServer } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** GET /api/analysis/jobs —— 代理：队列看板（状态汇总 + 最近任务） */
export async function GET(req: Request) {
  return proxyToServer(req, '/api/analysis/jobs');
}
