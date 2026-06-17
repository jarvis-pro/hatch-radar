import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, Lightbulb, Star } from 'lucide-react';
import type { Insight, PostRow, Triage } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import {
  AnalyzedBadge,
  INTENSITY_BORDER_L,
  IntensityBadge,
  SourceBadge,
  TriageStatusBadge,
} from '@/components/badges';
import { EmptyState, LoadError } from '@/components/empty';
import { channelLabel, fmtDate, permalinkUrl } from '@/lib/format';

/** 评分星级（1-5，实心至 value，其余描边） */
function RatingStars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`评分 ${value} / 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            'size-3.5',
            i < value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30',
          )}
        />
      ))}
    </span>
  );
}

function InsightDetailView() {
  const { id } = useParams<{ id: string }>();
  const detailQ = useQuery({
    queryKey: ['insight', id],
    queryFn: () =>
      api.get<{ insight: Insight; triage: Triage | null; post: PostRow | null }>(`/insights/${id}`),
  });

  if (detailQ.isError) {
    const status = detailQ.error instanceof ApiError ? detailQ.error.status : 0;
    return status === 404 ? (
      <EmptyState title="洞察不存在" hint="该洞察可能已被删除。" />
    ) : (
      <LoadError
        message={detailQ.error instanceof ApiError ? detailQ.error.message : undefined}
        onRetry={() => void detailQ.refetch()}
      />
    );
  }
  if (detailQ.isPending) return <Skeleton className="mx-auto h-96 max-w-5xl" />;

  const { insight, triage, post } = detailQ.data;

  return (
    <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-8">
      {/* 主列：信号 + 标题 + 标签 + 痛点 + 机会（限宽阅读列） */}
      <article className="min-w-0 space-y-6">
        <header>
          <IntensityBadge intensity={insight.intensity} />
          <h1 className="mt-3 text-2xl leading-snug font-semibold tracking-tight">
            {insight.postTitle}
          </h1>
          {insight.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {insight.tags.map((tag) => (
                <Badge key={tag} asChild variant="secondary" className="font-normal">
                  <Link to={`/insights?q=${encodeURIComponent(tag)}`}>{tag}</Link>
                </Badge>
              ))}
            </div>
          ) : null}
        </header>

        <section>
          <h2 className="mb-3 text-base font-semibold">痛点（{insight.painPoints.length}）</h2>
          {insight.painPoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">本帖未提炼出实质痛点信号。</p>
          ) : (
            <ul className="space-y-3">
              {insight.painPoints.map((pain, idx) => (
                <li
                  key={idx}
                  className={cn(
                    'rounded-lg border border-l-4 bg-card p-3',
                    INTENSITY_BORDER_L[pain.intensity],
                  )}
                >
                  <div className="flex items-start gap-2">
                    <IntensityBadge intensity={pain.intensity} />
                    <p className="font-medium">{pain.description}</p>
                  </div>
                  {pain.evidence ? (
                    <blockquote className="mt-2 border-l-2 pl-3 text-sm text-muted-foreground whitespace-pre-wrap wrap-break-word">
                      {pain.evidence}
                    </blockquote>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold">
            产品机会（{insight.opportunities.length}）
          </h2>
          {insight.opportunities.length === 0 ? (
            <p className="text-sm text-muted-foreground">本帖未推导出可行的产品方向。</p>
          ) : (
            <ul className="space-y-3">
              {insight.opportunities.map((opp, idx) => (
                <li key={idx} className="rounded-lg border bg-card p-3">
                  <h3 className="flex items-center gap-1.5 font-medium">
                    <Lightbulb className="size-4 text-intensity-medium" />
                    {opp.title}
                  </h3>
                  <p className="mt-1 text-sm">{opp.description}</p>
                  {opp.target_user ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      目标用户：{opp.target_user}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </article>

      {/* 右栏：来源 / 模型 / 操作 + 人工研判（大屏吸顶随读，小屏落到底部） */}
      <aside className="mt-6 space-y-4 lg:mt-0 lg:sticky lg:top-20">
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <SourceBadge source={insight.source} />
            <span>{channelLabel(insight.source, insight.subreddit)}</span>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>分析于 {fmtDate(insight.createdAt)}</div>
            <div>
              模型 <span className="font-mono">{insight.model}</span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 border-t pt-3 text-sm">
            {insight.permalink ? (
              <a
                href={permalinkUrl(insight.permalink)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                查看原帖
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
            {post ? (
              <Link
                to={`/posts/${post.id}`}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                站内帖子与评论
                <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
            {post ? <AnalyzedBadge analyzedAt={post.analyzed_at} /> : null}
          </div>
        </div>

        {triage ? (
          <div className="space-y-2 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">人工研判（移动端同步）</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <TriageStatusBadge status={triage.status} />
              {triage.rating != null ? <RatingStars value={triage.rating} /> : null}
              <span>更新于 {fmtDate(triage.updatedAt)}</span>
            </div>
            {triage.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {triage.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
            {triage.note ? (
              <p className="text-sm whitespace-pre-wrap wrap-break-word">{triage.note}</p>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

/** 洞察详情页：左主列（信号/标题/痛点/机会）+ 右栏（来源/模型/操作/人工研判）。 */
export function InsightDetailPage() {
  return (
    <RequirePerm perm="insights:view">
      <InsightDetailView />
    </RequirePerm>
  );
}
