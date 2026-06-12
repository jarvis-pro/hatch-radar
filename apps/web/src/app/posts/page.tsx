import Link from 'next/link';
import { ArrowUp, MessageSquare } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from '@hatch-radar/ui/components/item';
import { AnalyzedBadge, SourceBadge } from '@/components/badges';
import { DbSetupNotice, EmptyState } from '@/components/empty';
import { FilterBar } from '@/components/filter-bar';
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
      <h1 className="mb-4 text-lg font-semibold tracking-tight">
        帖子 <span className="text-sm font-normal text-muted-foreground">原始数据，30 天后归档</span>
      </h1>

      <FilterBar
        basePath="/posts"
        hasFilter={hasFilter}
        searchValue={q}
        searchPlaceholder="搜索标题 / 正文"
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
            name: 'status',
            placeholder: '全部状态',
            value: status ?? '',
            options: [
              { value: 'analyzed', label: '已分析' },
              { value: 'pending', label: '待分析' },
            ],
          },
        ]}
      />

      {result.items.length === 0 ? (
        <EmptyState
          title={hasFilter ? '没有符合条件的帖子' : '还没有帖子'}
          hint={hasFilter ? '试试放宽筛选条件。' : '启动 server 进程后会自动抓取目标版块。'}
        />
      ) : (
        <ItemGroup className="gap-2">
          {result.items.map((post) => (
            <Item key={post.id} asChild variant="outline">
              <Link href={`/posts/${post.id}`}>
                <ItemContent>
                  <ItemTitle className="line-clamp-2 text-sm">{post.title}</ItemTitle>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <SourceBadge source={post.source} />
                    <span>{channelLabel(post.source, post.subreddit)}</span>
                    {post.author ? <span>by {post.author}</span> : null}
                    <time>{timeAgo(post.created_utc)}</time>
                  </div>
                </ItemContent>
                <ItemActions className="basis-full justify-start gap-3 text-xs text-muted-foreground tabular-nums sm:basis-auto sm:justify-end">
                  <span className="inline-flex items-center gap-1">
                    <ArrowUp className="size-3.5" />
                    {post.score}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="size-3.5" />
                    {post.num_comments}
                  </span>
                  <AnalyzedBadge analyzedAt={post.analyzed_at} />
                </ItemActions>
              </Link>
            </Item>
          ))}
        </ItemGroup>
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
