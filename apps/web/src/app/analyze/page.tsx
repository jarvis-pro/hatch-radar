import {
  AnalyzeWorkbench,
  type ProviderOption,
  type WorkbenchItem,
} from '@/components/analyze-workbench';
import { DbSetupNotice } from '@/components/empty';
import { Pagination } from '@/components/pagination';
import { tryGetDb } from '@/lib/db';
import { channelLabel, parsePage } from '@/lib/format';
import { listAwaitingManualResult } from '@/lib/queries';
import { serverApiFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export const metadata = { title: '分析运行' };

interface SearchParams {
  page?: string;
}

interface ProviderDTO {
  id: number;
  label: string;
  enabled: boolean;
}

/** 取启用的模型清单与当前 active（经 server，失败不阻塞页面） */
async function loadProviders(): Promise<{
  providers: ProviderOption[];
  activeProviderId: number | null;
  error: string | null;
}> {
  try {
    const resp = await serverApiFetch('/api/settings');
    if (!resp.ok)
      return { providers: [], activeProviderId: null, error: `模型列表加载失败（${resp.status}）` };
    const data = (await resp.json()) as {
      providers: ProviderDTO[];
      activeProviderId: number | null;
    };
    return {
      providers: data.providers.filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.label })),
      activeProviderId: data.activeProviderId,
      error: null,
    };
  } catch {
    return { providers: [], activeProviderId: null, error: '无法连接工作台 server 进程' };
  }
}

export default async function AnalyzePage(props: { searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const db = tryGetDb();
  if (!db) return <DbSetupNotice />;

  const result = listAwaitingManualResult(db, parsePage(sp.page));
  const { providers, activeProviderId, error } = await loadProviders();

  const items: WorkbenchItem[] = result.items.map((p) => ({
    id: p.id,
    title: p.title,
    channel: channelLabel(p.source, p.subreddit),
    kind: p.kind,
  }));

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">
        分析运行{' '}
        <span className="text-sm font-normal text-muted-foreground">
          选中帖子 + 选模型 → 运行；交由队列后台处理
        </span>
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        待分析 <span className="font-medium text-foreground tabular-nums">{result.total}</span>
      </p>

      <AnalyzeWorkbench
        items={items}
        providers={providers}
        defaultProviderId={activeProviderId}
        providersError={error}
      />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/analyze"
        query={{}}
      />
    </>
  );
}
