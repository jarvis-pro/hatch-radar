import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AwaitingPost, Paged } from '@hatch-radar/shared';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import {
  AnalyzeWorkbench,
  type ProviderOption,
  type WorkbenchItem,
} from '@/components/analyze-workbench';
import { LoadError } from '@/components/empty';
import { Pagination } from '@/components/pagination';
import { channelLabel, parsePage } from '@/lib/format';
import { buildQuery } from '@/lib/qs';

interface ProviderOpts {
  providers: ProviderOption[];
  activeProviderId: number | null;
}

function AnalyzeView() {
  const [sp] = useSearchParams();
  const page = parsePage(sp.get('page'));

  const awaitingQ = useQuery({
    queryKey: ['awaiting', page],
    queryFn: () =>
      api.get<Paged<AwaitingPost>>(
        `/posts/awaiting${buildQuery({ page: page > 1 ? page : undefined })}`,
      ),
  });
  const providersQ = useQuery({
    queryKey: ['analysis-providers'],
    queryFn: () => api.get<ProviderOpts>('/analysis/providers'),
  });

  if (awaitingQ.isError) {
    return (
      <LoadError
        message={awaitingQ.error instanceof ApiError ? awaitingQ.error.message : undefined}
      />
    );
  }

  const providers = providersQ.data?.providers ?? [];
  const activeProviderId = providersQ.data?.activeProviderId ?? null;
  const providersError = providersQ.isError
    ? providersQ.error instanceof ApiError
      ? providersQ.error.message
      : '模型列表加载失败'
    : null;

  const result = awaitingQ.data;
  const items: WorkbenchItem[] = (result?.items ?? []).map((p) => ({
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
        待分析{' '}
        <span className="font-medium text-foreground tabular-nums">{result?.total ?? '…'}</span>
      </p>

      {awaitingQ.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <AnalyzeWorkbench
          items={items}
          providers={providers}
          defaultProviderId={activeProviderId}
          providersError={providersError}
        />
      )}

      {result ? (
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          basePath="/analyze"
          query={{}}
        />
      ) : null}
    </>
  );
}

/** 分析运行页（analyze:run）：多选待分析帖子 + 选模型 → 入队，实时看队列。 */
export function AnalyzePage() {
  return (
    <RequirePerm perm="analyze:run">
      <AnalyzeView />
    </RequirePerm>
  );
}
