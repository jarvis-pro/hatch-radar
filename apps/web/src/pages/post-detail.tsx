import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, ExternalLink } from 'lucide-react';
import type { CommentRow, Insight, PostRow } from '@hatch-radar/shared';
import { Card } from '@hatch-radar/ui/components/card';
import { Separator } from '@hatch-radar/ui/components/separator';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { AnalyzedBadge, SourceBadge } from '@/components/badges';
import { CommentTree } from '@/components/comment-tree';
import { EmptyState, LoadError } from '@/components/empty';
import { channelLabel, fmtDate, permalinkUrl } from '@/lib/format';

function PostDetailView() {
  const { id } = useParams<{ id: string }>();
  const detailQ = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.get<{ post: PostRow; insight: Insight | null }>(`/posts/${id}`),
  });
  const commentsQ = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => api.get<CommentRow[]>(`/posts/${id}/comments`),
    enabled: detailQ.isSuccess,
  });

  if (detailQ.isError) {
    const status = detailQ.error instanceof ApiError ? detailQ.error.status : 0;
    return status === 404 ? (
      <EmptyState
        title="帖子不存在或已归档"
        hint="原始帖子 30 天后归档，其洞察仍可在洞察页查看。"
      />
    ) : (
      <LoadError
        message={detailQ.error instanceof ApiError ? detailQ.error.message : undefined}
        onRetry={() => void detailQ.refetch()}
      />
    );
  }
  if (detailQ.isPending) return <Skeleton className="h-96 w-full" />;

  const { post, insight } = detailQ.data;
  const comments = commentsQ.data ?? [];

  return (
    <Card className="mx-auto max-w-3xl gap-0 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <SourceBadge source={post.source} />
        <span>{channelLabel(post.source, post.subreddit)}</span>
        {post.author ? <span>by {post.author}</span> : null}
        <span className="inline-flex items-center gap-0.5 tabular-nums">
          <ArrowUp className="size-3" />
          {post.score}
        </span>
        <time>{fmtDate(post.created_utc)}</time>
        <AnalyzedBadge analyzedAt={post.analyzed_at} />
      </div>
      <h1 className="mt-3 text-xl leading-snug font-semibold tracking-tight">{post.title}</h1>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {post.permalink ? (
          <a
            href={permalinkUrl(post.permalink)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            查看原帖
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        {post.url && post.url !== post.permalink ? (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            外部链接
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        {insight ? (
          <Link
            to={`/insights/${insight.id}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            查看 AI 洞察
            <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {post.selftext ? (
        <div className="mt-4 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
          {post.selftext}
        </div>
      ) : null}

      <Separator className="my-5" />
      <h2 className="mb-3 text-base font-semibold">评论（{comments.length}）</h2>
      {commentsQ.isPending ? (
        <Spinner className="size-5 text-muted-foreground" />
      ) : (
        <CommentTree comments={comments} />
      )}
    </Card>
  );
}

/** 帖子详情页：帖子正文 + 评论树 + 关联洞察跳转。 */
export function PostDetailPage() {
  return (
    <RequirePerm perm="posts:view">
      <PostDetailView />
    </RequirePerm>
  );
}
