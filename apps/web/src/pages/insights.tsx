import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, FileText, MessageSquare, Sparkles, type LucideIcon } from 'lucide-react';
import type { DbStats, FilterOptions, Insight, Paged } from '@hatch-radar/shared';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { ExportBatchButton } from '@/components/export-batch';
import { FilterBar } from '@/components/filter-bar';
import { InsightCard } from '@/components/insight-card';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { StatCard } from '@/components/stat-card';
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
  const statItems: { label: string; value: number | undefined; icon: LucideIcon }[] = [
    { label: '洞察', value: stats?.insights, icon: Sparkles },
    { label: '帖子', value: stats?.posts, icon: FileText },
    { label: '评论', value: stats?.comments, icon: MessageSquare },
    { label: '待分析', value: stats?.pendingAnalysis, icon: Clock },
  ];

  return (
    <>
      <PageHeader
        title="洞察"
        description="社区痛点与产品机会，按来源 / 版块 / 强度筛选研判"
        actions={<ExportBatchButton subreddits={options.subreddits} />}
      />

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statItems.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            icon={s.icon}
            value={
              s.value != null ? (
                s.value.toLocaleString()
              ) : (
                <Skeleton className="inline-block h-7 w-12 align-middle" />
              )
            }
          />
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
