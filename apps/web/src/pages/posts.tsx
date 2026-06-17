import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, MessageSquare } from 'lucide-react';
import type { FilterOptions, Paged, PostRow } from '@hatch-radar/shared';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from '@hatch-radar/ui/components/item';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { AnalyzedBadge, SourceBadge } from '@/components/badges';
import { DensityToggle } from '@/components/density-toggle';
import { EmptyState, LoadError } from '@/components/empty';
import { FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { channelLabel, parsePage, sourceLabel, timeAgo } from '@/lib/format';
import { buildQuery } from '@/lib/qs';
import { useDensity } from '@/lib/use-density';

function PostsView() {
  const [sp] = useSearchParams();
  const source = sp.get('source') || undefined;
  const subreddit = sp.get('subreddit') || undefined;
  const statusRaw = sp.get('status');
  const status: 'analyzed' | 'pending' | undefined =
    statusRaw === 'analyzed' ? 'analyzed' : statusRaw === 'pending' ? 'pending' : undefined;
  const q = sp.get('q')?.trim() || undefined;
  const page = parsePage(sp.get('page'));
  const hasFilter = Boolean(source || subreddit || status || q);
  const [density, setDensity] = useDensity();
  const compact = density === 'compact';

  const optionsQ = useQuery({
    queryKey: ['post-filters'],
    queryFn: () => api.get<FilterOptions>('/posts/filters'),
  });
  const listQ = useQuery({
    queryKey: ['posts', source, subreddit, status, q, page],
    queryFn: () =>
      api.get<Paged<PostRow>>(
        `/posts${buildQuery({ source, subreddit, status, q, page: page > 1 ? page : undefined })}`,
      ),
  });

  const options = optionsQ.data ?? { sources: [], subreddits: [] };

  return (
    <>
      <PageHeader
        title="帖子库"
        description="原始抓取数据，30 天后归档；可在此挑选帖子发起分析"
        actions={<DensityToggle value={density} onChange={setDensity} />}
      />

      <FilterBar
        basePath="/posts"
        hasFilter={hasFilter}
        searchValue={q}
        searchPlaceholder="搜索标题 / 正文"
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

      {listQ.isError ? (
        <LoadError
          message={listQ.error instanceof ApiError ? listQ.error.message : undefined}
          onRetry={() => void listQ.refetch()}
        />
      ) : listQ.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : listQ.data.items.length === 0 ? (
        <EmptyState
          title={hasFilter ? '没有符合条件的帖子' : '还没有帖子'}
          hint={hasFilter ? '试试放宽筛选条件。' : '启动 server 进程后会自动抓取目标版块。'}
        />
      ) : (
        <>
          <ItemGroup className="gap-2">
            {listQ.data.items.map((post) => (
              <Item
                key={post.id}
                asChild
                variant="outline"
                size={compact ? 'sm' : 'default'}
                className={compact ? 'py-2' : undefined}
              >
                <Link to={`/posts/${post.id}`}>
                  <ItemContent className={compact ? 'gap-0.5' : undefined}>
                    <ItemTitle className={cn('text-sm', compact ? 'line-clamp-1' : 'line-clamp-2')}>
                      {post.title}
                    </ItemTitle>
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
          <Pagination
            page={listQ.data.page}
            pageCount={listQ.data.pageCount}
            total={listQ.data.total}
            basePath="/posts"
            query={{ source, subreddit, status, q }}
          />
        </>
      )}
    </>
  );
}

/** 帖子列表页：筛选 + 列表 + 分页。 */
export function PostsPage() {
  return (
    <RequirePerm perm="posts:view">
      <PostsView />
    </RequirePerm>
  );
}
