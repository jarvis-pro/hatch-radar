import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DbStats, FilterOptions, Insight, Paged } from '@hatch-radar/shared';
import { Card } from '@hatch-radar/ui/components/card';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { ExportBatchButton } from '@/components/export-batch';
import { FilterBar } from '@/components/filter-bar';
import { InsightCard } from '@/components/insight-card';
import { Pagination } from '@/components/pagination';
import { INTENSITY_LABELS, parseIntensity, parsePage, sourceLabel } from '@/lib/format';
import { buildQuery } from '@/lib/qs';

function InsightsView() {
  const [sp] = useSearchParams();
  const source = sp.get('source') || undefined;
  const subreddit = sp.get('subreddit') || undefined;
  const intensity = parseIntensity(sp.get('intensity'));
  const q = sp.get('q')?.trim() || undefined;
  const page = parsePage(sp.get('page'));
  const hasFilter = Boolean(source || subreddit || intensity || q);

  const statsQ = useQuery({ queryKey: ['stats'], queryFn: () => api.get<DbStats>('/stats') });
  const optionsQ = useQuery({
    queryKey: ['insight-filters'],
    queryFn: () => api.get<FilterOptions>('/insights/filters'),
  });
  const listQ = useQuery({
    queryKey: ['insights', source, subreddit, intensity, q, page],
    queryFn: () =>
      api.get<Paged<Insight>>(
        `/insights${buildQuery({ source, subreddit, intensity, q, page: page > 1 ? page : undefined })}`,
      ),
  });

  const options = optionsQ.data ?? { sources: [], subreddits: [] };
  const stats = statsQ.data;
  const statItems = [
    { label: '洞察', value: stats?.insights },
    { label: '帖子', value: stats?.posts },
    { label: '评论', value: stats?.comments },
    { label: '待分析', value: stats?.pendingAnalysis },
  ];

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">洞察</h1>
        <ExportBatchButton subreddits={options.subreddits} />
      </div>

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statItems.map((s) => (
          <Card key={s.label} className="gap-1 p-4">
            <span className="text-2xl font-semibold tabular-nums">
              {s.value ?? <Skeleton className="inline-block h-7 w-10 align-middle" />}
            </span>
            <span className="text-sm text-muted-foreground">{s.label}</span>
          </Card>
        ))}
      </section>

      <FilterBar
        basePath="/"
        hasFilter={hasFilter}
        searchValue={q}
        searchPlaceholder="搜索标题 / 标签 / 痛点 / 机会"
        selects={[
          {
            name: 'source',
            placeholder: '全部来源',
            value: source ?? '',
            options: options.sources.map((s) => ({ value: s, label: sourceLabel(s) })),
          },
          {
            name: 'subreddit',
            placeholder: '全部版块',
            value: subreddit ?? '',
            options: options.subreddits.map((s) => ({ value: s, label: s })),
          },
          {
            name: 'intensity',
            placeholder: '全部强度',
            value: intensity ?? '',
            options: (['HIGH', 'MEDIUM', 'LOW'] as const).map((level) => ({
              value: level,
              label: `${INTENSITY_LABELS[level]}强度`,
            })),
          },
        ]}
      />

      {listQ.isError ? (
        <LoadError message={listQ.error instanceof ApiError ? listQ.error.message : undefined} />
      ) : listQ.isPending ? (
        <ListSkeleton />
      ) : listQ.data.items.length === 0 ? (
        <EmptyState
          title={hasFilter ? '没有符合条件的洞察' : '还没有洞察'}
          hint={
            hasFilter
              ? '试试放宽筛选条件。'
              : '待 server 完成评论回捞与 AI 分析后，洞察会陆续出现在这里。'
          }
        />
      ) : (
        <>
          <section className="grid gap-3">
            {listQ.data.items.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </section>
          <Pagination
            page={listQ.data.page}
            pageCount={listQ.data.pageCount}
            total={listQ.data.total}
            basePath="/"
            query={{ source, subreddit, intensity, q }}
          />
        </>
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}

/** 洞察首页（默认路由）：统计卡片 + 筛选 + 列表 + 分页 + 导出。 */
export function InsightsPage() {
  return (
    <RequirePerm perm="insights:view">
      <InsightsView />
    </RequirePerm>
  );
}
