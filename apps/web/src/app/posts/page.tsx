import Link from 'next/link';
import { AnalyzedBadge, SourceBadge } from '@/components/badges';
import { DbSetupNotice, EmptyState } from '@/components/empty';
import { Pagination } from '@/components/pagination';
import { tryGetDb } from '@/lib/db';
import { channelLabel, parsePage, sourceLabel, timeAgo } from '@/lib/format';
import { listPosts, postFilterOptions } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export const metadata = { title: '帖子' };

interface SearchParams {
  source?: string;
  subreddit?: string;
  status?: string;
  q?: string;
  page?: string;
}

export default async function PostsPage(props: { searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const db = tryGetDb();
  if (!db) return <DbSetupNotice />;

  const options = postFilterOptions(db);
  const status: 'analyzed' | 'pending' | undefined =
    sp.status === 'analyzed' ? 'analyzed' : sp.status === 'pending' ? 'pending' : undefined;
  const q = sp.q?.trim() || undefined;
  const filter = {
    source: sp.source || undefined,
    subreddit: sp.subreddit || undefined,
    status,
    q,
    page: parsePage(sp.page),
  };
  const result = listPosts(db, filter);
  const hasFilter = Boolean(filter.source || filter.subreddit || filter.status || filter.q);

  return (
    <>
      <h1 className="page-title">帖子（原始数据，30 天后归档）</h1>

      <form className="filter-bar" method="get" action="/posts">
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
        <select name="status" defaultValue={status ?? ''}>
          <option value="">全部状态</option>
          <option value="analyzed">已分析</option>
          <option value="pending">待分析</option>
        </select>
        <input type="search" name="q" placeholder="搜索标题 / 正文" defaultValue={q ?? ''} />
        <button type="submit">筛选</button>
        {hasFilter ? (
          <a className="filter-reset" href="/posts">
            重置
          </a>
        ) : null}
      </form>

      {result.items.length === 0 ? (
        <EmptyState
          title={hasFilter ? '没有符合条件的帖子' : '还没有帖子'}
          hint={hasFilter ? '试试放宽筛选条件。' : '启动 server 进程后会自动抓取目标版块。'}
        />
      ) : (
        <ul className="post-list">
          {result.items.map((post) => (
            <li className="post-row" key={post.id}>
              <div className="post-row-main">
                <Link href={`/posts/${post.id}`} className="post-row-title">
                  {post.title}
                </Link>
                <div className="card-meta">
                  <SourceBadge source={post.source} />
                  <span>{channelLabel(post.source, post.subreddit)}</span>
                  {post.author ? <span>by {post.author}</span> : null}
                  <time>{timeAgo(post.created_utc)}</time>
                </div>
              </div>
              <div className="post-row-side">
                <span className="muted">▲ {post.score}</span>
                <span className="muted">评论 {post.num_comments}</span>
                <AnalyzedBadge analyzedAt={post.analyzed_at} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/posts"
        query={{ source: filter.source, subreddit: filter.subreddit, status, q }}
      />
    </>
  );
}
