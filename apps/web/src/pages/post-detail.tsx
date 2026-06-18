import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, ExternalLink } from 'lucide-react';
import type { CommentRow, Insight, PostRow } from '@hatch-radar/shared';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';
import { can, useAuth } from '@/auth/auth-context';
import { RequirePerm } from '@/auth/require-perm';
import { AnalyzedBadge, SourceBadge } from '@/components/badges';
import { CommentTree } from '@/components/comment-tree';
import { EmptyState, LoadError } from '@/components/empty';
import { InspectLaunchButton } from '@/components/inspect-launch';
import { TranslationButton } from '@/components/translation-button';
import { TranslationViewProvider, usePostTranslation } from '@/translation/post-translation';
import { channelLabel, decodeEntities, fmtDate, permalinkUrl } from '@/lib/format';

function PostDetailView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const detailQ = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.get<{ post: PostRow; insight: Insight | null }>(`/posts/${id}`),
  });
  const commentsQ = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => api.get<CommentRow[]>(`/posts/${id}/comments`),
    enabled: detailQ.isSuccess,
  });
  const tr = usePostTranslation(id);

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
  if (detailQ.isPending) return <Skeleton className="mx-auto h-96 max-w-5xl" />;

  const { post, insight } = detailQ.data;
  const comments = commentsQ.data ?? [];

  return (
    <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-8">
      {/* 主列：标题 + 正文 + 评论树（限宽阅读列）；译文视图向下传给评论树 */}
      <TranslationViewProvider value={tr.view}>
        <article className="min-w-0 space-y-5">
          <header className="space-y-2">
            <h1 className="text-xl leading-snug font-semibold tracking-tight">
              {(tr.showZh ? tr.view.get(post.title_hash) : undefined) ?? post.title}
            </h1>
            <TranslationButton t={tr} />
            {post.selftext ? (
              <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
                {decodeEntities(
                  (tr.showZh ? tr.view.get(post.selftext_hash) : undefined) ?? post.selftext,
                )}
              </div>
            ) : null}
          </header>

          <section>
            <h2 className="mb-3 text-base font-semibold">评论（{comments.length}）</h2>
            {commentsQ.isPending ? (
              <Spinner className="size-5 text-muted-foreground" />
            ) : (
              <CommentTree comments={comments} />
            )}
          </section>
        </article>
      </TranslationViewProvider>

      {/* 右栏：来源 / 作者 / 热度 / 分析状态 + 跳转链接 */}
      <aside className="mt-6 space-y-4 lg:mt-0 lg:sticky lg:top-20">
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <SourceBadge source={post.source} />
            <span>{channelLabel(post.source, post.subreddit)}</span>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            {post.author ? <div>作者 {post.author}</div> : null}
            <div className="inline-flex items-center gap-1 tabular-nums">
              <ArrowUp className="size-3" />
              {post.score} · {fmtDate(post.created_utc)}
            </div>
          </div>
          <div>
            <AnalyzedBadge analyzedAt={post.analyzed_at} />
          </div>
          {can(user, 'analyze:run') ? (
            <InspectLaunchButton postId={post.id} className="w-full" />
          ) : null}
          <div className="flex flex-col items-start gap-2 border-t pt-3 text-sm">
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
        </div>
      </aside>
    </div>
  );
}

/** 帖子详情页：左主列（标题/正文/评论）+ 右栏（来源/作者/链接/关联洞察）。 */
export function PostDetailPage() {
  return (
    <RequirePerm perm="posts:view">
      <PostDetailView />
    </RequirePerm>
  );
}
