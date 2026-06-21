/**
 * 洞察详情（/radar/insights/:id）—— 单条洞察全展开：痛点 + 证据、产品机会、人工研判。
 *
 * 左主列读它（信号 / 标题 / 标签 / 痛点[证据] / 机会[目标用户]），右栏看它的来源 / 模型 / 研判，
 * 并可下钻源帖一生。痛点强度色用 radar INTENSITY_META；研判（移动端同步）复用 TriageStatusBadge。
 */
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, ExternalLink, Lightbulb, Star } from 'lucide-react';
import type { RadarSourceKind } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { TriageStatusBadge } from '@/components/badges';
import { LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { fmtDate, permalinkUrl, timeAgo } from '@/lib/format';
import { INTENSITY_META, SOURCE_META } from './constants';
import { useInsightDetail } from './hooks';

/** 人工评分星级（1-5，实心至 value）。 */
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
  const { id = '' } = useParams();
  const q = useInsightDetail(id);

  if (q.isError) {
    return (
      <>
        <PageHeader title="洞察详情" description="单条洞察的痛点、产品机会与人工研判。" />
        <LoadError onRetry={() => void q.refetch()} />
      </>
    );
  }
  if (q.isPending) return <Skeleton className="mx-auto h-96 max-w-5xl" />;

  const d = q.data;
  const im = INTENSITY_META[d.intensity];
  const srcMeta = SOURCE_META[d.source as RadarSourceKind];
  const SrcIcon = srcMeta?.icon;

  return (
    <>
      <PageHeader
        title="洞察详情"
        description="单条洞察的痛点、产品机会与人工研判；可下钻其源帖一生。"
      />
      <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-8">
        {/* 左主列：信号 + 标题 + 标签 + 痛点（证据）+ 机会（目标用户） */}
        <article className="min-w-0 space-y-6">
          <header>
            <Badge variant="outline" className={cn('gap-1 px-1.5', im.text)}>
              <span aria-hidden className={cn('size-1.5 rounded-full', im.bar)} />
              {im.label}信号
            </Badge>
            <h1 className="mt-3 text-2xl leading-snug font-semibold tracking-tight text-balance">
              {d.titleZh ?? d.postTitle}
            </h1>
            {d.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {d.tags.map((t) => (
                  <Badge key={t} asChild variant="secondary" className="font-normal">
                    <Link to={`/radar/insights?q=${encodeURIComponent(t)}`}>{t}</Link>
                  </Badge>
                ))}
              </div>
            ) : null}
          </header>

          <section>
            <h2 className="mb-3 text-base font-semibold">痛点（{d.painPoints.length}）</h2>
            {d.painPoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">本帖未提炼出实质痛点信号。</p>
            ) : (
              <ul className="space-y-3">
                {d.painPoints.map((pp, idx) => {
                  const pim = INTENSITY_META[pp.intensity];
                  return (
                    <li
                      key={idx}
                      className="relative overflow-hidden rounded-lg border bg-card p-3 pl-4"
                    >
                      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', pim.bar)} />
                      <div className="flex items-start gap-2">
                        <Badge variant="outline" className={cn('mt-0.5 shrink-0 px-1.5', pim.text)}>
                          {pim.label}
                        </Badge>
                        <p className="font-medium">{pp.description}</p>
                      </div>
                      {pp.evidence ? (
                        <blockquote className="mt-2 border-l-2 pl-3 text-sm whitespace-pre-wrap text-muted-foreground wrap-break-word">
                          {pp.evidence}
                        </blockquote>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold">产品机会（{d.opportunities.length}）</h2>
            {d.opportunities.length === 0 ? (
              <p className="text-sm text-muted-foreground">本帖未推导出可行的产品方向。</p>
            ) : (
              <ul className="space-y-3">
                {d.opportunities.map((opp, idx) => (
                  <li key={idx} className="rounded-lg border bg-card p-3">
                    <h3 className="flex items-center gap-1.5 font-medium">
                      <Lightbulb className="size-4 text-intensity-medium" />
                      {opp.title}
                    </h3>
                    <p className="mt-1 text-sm">{opp.description}</p>
                    {opp.targetUser ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        目标用户：{opp.targetUser}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </article>

        {/* 右栏：来源 / 模型 / 链接 + 人工研判（大屏吸顶随读） */}
        <aside className="mt-6 space-y-4 lg:mt-0 lg:sticky lg:top-20">
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                {SrcIcon ? <SrcIcon className="size-3.5" /> : null}
                {srcMeta?.label ?? d.source}
              </span>
              <span>· {d.channel}</span>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>分析于 {fmtDate(d.createdAt)}</div>
              <div>
                模型 <span className="font-mono">{d.model}</span>
              </div>
            </div>
            <div className="flex flex-col items-start gap-2 border-t pt-3 text-sm">
              {d.permalink ? (
                <a
                  href={permalinkUrl(d.permalink)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  查看原帖
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
              {d.postExists ? (
                <Link
                  to={`/radar/posts/${d.postId}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  站内帖子与一生
                  <ArrowRight className="size-3.5" />
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground/70">源帖已归档</span>
              )}
            </div>
          </div>

          {d.triage ? (
            <div className="space-y-2 rounded-lg border p-4">
              <h2 className="text-sm font-semibold">人工研判（移动端同步）</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <TriageStatusBadge status={d.triage.status} />
                {d.triage.rating != null ? <RatingStars value={d.triage.rating} /> : null}
                {d.triage.updatedAt > 0 ? <span>更新于 {timeAgo(d.triage.updatedAt)}</span> : null}
              </div>
              {d.triage.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {d.triage.tags.map((t) => (
                    <Badge key={t} variant="outline" className="font-normal">
                      {t}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {d.triage.note ? (
                <p className="text-sm whitespace-pre-wrap wrap-break-word">{d.triage.note}</p>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}

/** 洞察详情页（insights:view）：痛点 / 机会 / 研判全展开。 */
export function RadarInsightDetailPage() {
  return (
    <RequirePerm perm="insights:view">
      <InsightDetailView />
    </RequirePerm>
  );
}
