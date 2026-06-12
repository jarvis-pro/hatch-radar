import { DbSetupNotice, EmptyState } from '@/components/empty';
import { InsightCard } from '@/components/insight-card';
import { Pagination } from '@/components/pagination';
import { tryGetDb } from '@/lib/db';
import { INTENSITY_LABELS, parseIntensity, parsePage, sourceLabel } from '@/lib/format';
import { getStats, insightFilterOptions, listInsights } from '@/lib/queries';

// 每次请求都读最新数据；构建机上没有数据库，禁止任何预渲染
export const dynamic = 'force-dynamic';

interface SearchParams {
  source?: string;
  subreddit?: string;
  intensity?: string;
  q?: string;
  page?: string;
}

export default async function InsightsPage(props: { searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const db = tryGetDb();
  if (!db) return <DbSetupNotice />;

  const stats = getStats(db);
  const options = insightFilterOptions(db);
  const intensity = parseIntensity(sp.intensity);
  const q = sp.q?.trim() || undefined;
  const filter = {
    source: sp.source || undefined,
    subreddit: sp.subreddit || undefined,
    intensity,
    q,
    page: parsePage(sp.page),
  };
  const result = listInsights(db, filter);
  const hasFilter = Boolean(filter.source || filter.subreddit || filter.intensity || filter.q);

  return (
    <>
      <section className="stats">
        <div className="stat">
          <span className="stat-num">{stats.insights}</span>
          <span className="stat-label">洞察</span>
        </div>
        <div className="stat">
          <span className="stat-num">{stats.posts}</span>
          <span className="stat-label">帖子</span>
        </div>
        <div className="stat">
          <span className="stat-num">{stats.comments}</span>
          <span className="stat-label">评论</span>
        </div>
        <div className="stat">
          <span className="stat-num">{stats.pendingAnalysis}</span>
          <span className="stat-label">待分析</span>
        </div>
      </section>

      <form className="filter-bar" method="get" action="/">
        <select name="source" defaultValue={filter.source ?? ''}>
          <option value="">全部来源</option>
          {options.sources.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
        <select name="subreddit" defaultValue={filter.subreddit ?? ''}>
          <option value="">全部版块</option>
          {options.subreddits.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="intensity" defaultValue={intensity ?? ''}>
          <option value="">全部强度</option>
          {(['HIGH', 'MEDIUM', 'LOW'] as const).map((level) => (
            <option key={level} value={level}>
              {INTENSITY_LABELS[level]}强度
            </option>
          ))}
        </select>
        <input
          type="search"
          name="q"
          placeholder="搜索标题 / 标签 / 痛点 / 机会"
          defaultValue={q ?? ''}
        />
        <button type="submit">筛选</button>
        {hasFilter ? (
          <a className="filter-reset" href="/">
            重置
          </a>
        ) : null}
      </form>

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
        <section className="card-list">
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
