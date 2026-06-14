import { Card } from '@hatch-radar/ui/components/card';
import { DbSetupNotice, EmptyState } from '@/components/empty';
import { ExportBatchButton } from '@/components/export-batch';
import { FilterBar } from '@/components/filter-bar';
import { InsightCard } from '@/components/insight-card';
import { Pagination } from '@/components/pagination';
import { tryGetDb } from '@/lib/db';
import { INTENSITY_LABELS, parseIntensity, parsePage, sourceLabel } from '@/lib/format';
import { getStats, insightFilterOptions, listInsights } from '@/lib/queries';

// 每次请求都读最新数据；构建机上没有数据库，禁止任何预渲染
export const dynamic = 'force-dynamic';

/** 洞察首页的 URL 查询参数（全部可选，缺省即不过滤） */
interface SearchParams {
  /** 来源平台筛选 */
  source?: string;
  /** subreddit 筛选 */
  subreddit?: string;
  /** 强度筛选 */
  intensity?: string;
  /** 关键词搜索 */
  q?: string;
  /** 页码（从 1 开始，字符串形式） */
  page?: string;
}

export default async function InsightsPage(props: { searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const db = await tryGetDb();
  if (!db) return <DbSetupNotice />;

  const intensity = parseIntensity(sp.intensity);
  const q = sp.q?.trim() || undefined;
  const filter = {
    source: sp.source || undefined,
    subreddit: sp.subreddit || undefined,
    intensity,
    q,
    page: parsePage(sp.page),
  };
  const [stats, options, result] = await Promise.all([
    getStats(db),
    insightFilterOptions(db),
    listInsights(db, filter),
  ]);
  const hasFilter = Boolean(filter.source || filter.subreddit || filter.intensity || filter.q);

  const statItems = [
    { label: '洞察', value: stats.insights },
    { label: '帖子', value: stats.posts },
    { label: '评论', value: stats.comments },
    { label: '待分析', value: stats.pendingAnalysis },
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
            <span className="text-2xl font-semibold tabular-nums">{s.value}</span>
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
            value: filter.source ?? '',
            options: options.sources.map((s) => ({ value: s, label: sourceLabel(s) })),
          },
          {
            name: 'subreddit',
            placeholder: '全部版块',
            value: filter.subreddit ?? '',
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

      {result.items.length === 0 ? (
        <EmptyState
          title={hasFilter ? '没有符合条件的洞察' : '还没有洞察'}
          hint={
            hasFilter
              ? '试试放宽筛选条件。'
              : '待 server 完成评论回捞与 AI 分析后，洞察会陆续出现在这里。'
          }
        />
      ) : (
        <section className="grid gap-3">
          {result.items.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </section>
      )}

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/"
        query={{ source: filter.source, subreddit: filter.subreddit, intensity, q }}
      />
    </>
  );
}
