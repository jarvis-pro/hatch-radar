/**
 * 帖子详情（/radar/posts/:id）—— 一页讲一条帖：左读它、右看它的命运。
 *
 * 无卡片设计：靠排版层级与留白分区（不再用带边框的卡片包裹），弱化板块边界感。
 * 左（读它）：完整内容 —— 标题 / 正文 / 多级评论树（译文优先；评论加大字号 + 明显层级缩进）。
 * 右（它的一生，sticky 侧栏）：复查状态（退避节奏）+ 跨运行时间线（最近 N 条）+ 产出洞察。
 * PageHeader 有翻译按钮 + 「译文 / 原文」切换（真实翻译系统：按内容哈希取译文，未命中回退原文）。
 */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowBigUp, Languages, MessageSquare } from 'lucide-react';
import type { PostLifecycleEvent, RadarCommentDTO, RadarSourceKind } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import { can, useAuth } from '@/auth/auth-context';
import { RequirePerm } from '@/auth/require-perm';
import { LoadError } from '@/components/empty';
import { InspectLaunchButton } from '@/components/inspect-launch';
import { PageHeader } from '@/components/page-header';
import { TranslationButton } from '@/components/translation-button';
import { commentAvatarDataUri } from '@/lib/avatar';
import { timeAgo } from '@/lib/format';
import {
  TranslationViewProvider,
  useTranslationView,
  usePostTranslation,
} from '@/translation/post-translation';
import { INTENSITY_META, SOURCE_META, TASK_STATUS_META } from './constants';
import { usePostDetail } from './hooks';

const CAP = 16;
const TIMELINE_CAP = 10; // 一生时间线只显示最近 N 条事件

function intervalLabel(misses: number): string {
  if (misses <= 0) {
    return '每轮查';
  }
  return `隔 ${Math.min(2 ** (misses - 1), CAP)} 轮`;
}

/** 跨运行事件 → 一句话标签（据 kind/status/sweep 现算）。 */
function eventLabel(ev: PostLifecycleEvent): string {
  if (ev.kind === 'collect') {
    return '采集入库';
  }
  if (ev.kind === 'analyze') {
    if (ev.status === 'failed') {
      return 'AI 分析失败';
    }
    if (ev.status === 'succeeded') {
      return 'AI 分析 → 产出洞察';
    }
    return 'AI 分析中';
  }
  if (ev.kind === 'recheck') {
    const s = ev.sweepSeq != null ? `复查 #${ev.sweepSeq}` : '复查';
    if (ev.status === 'skipped') {
      return `${s} · 未变化（退避）`;
    }
    if (ev.status === 'succeeded') {
      return `${s} · 有变化 → 重抓`;
    }
    if (ev.status === 'failed') {
      return `${s} · 失败`;
    }
    return `${s} · 进行中`;
  }
  return ev.kind;
}

function countComments(nodes: RadarCommentDTO[]): number {
  let n = 0;
  for (const x of nodes) {
    n += 1 + (x.children ? countComments(x.children) : 0);
  }
  return n;
}

/** 一条评论：加大正文字号、层级以更明显的缩进 + 左侧轨道线表达；译文经内容哈希按需切换。 */
function CommentNode({ c }: { c: RadarCommentDTO }) {
  const tv = useTranslationView();
  const body = (tv.showZh ? tv.get(c.bodyHash) : undefined) ?? c.body;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <img
          src={commentAvatarDataUri(c.author ?? '')}
          alt=""
          aria-hidden
          className="size-5 shrink-0 rounded-full bg-muted"
        />
        <span className="font-medium text-foreground">u/{c.author ?? '匿名'}</span>
        <span className="text-muted-foreground">· ↑{c.score}</span>
        {c.createdUtc ? (
          <span className="text-muted-foreground/70">· {timeAgo(c.createdUtc)}</span>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      {c.children && c.children.length > 0 ? (
        <div className="mt-3 space-y-4 border-l-2 border-border pl-5">
          {c.children.map((ch) => (
            <CommentNode key={ch.id} c={ch} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 右侧侧栏的分区小标题（无边框，纯排版分区）。 */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-semibold tracking-wide text-muted-foreground/80">{children}</div>
  );
}

function PostDetailView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryResult = usePostDetail(id ?? '');
  const tr = usePostTranslation(id);

  if (queryResult.isError) {
    return (
      <>
        <PageHeader title="帖子" description="逐帖透视一条情报的完整内容与跨运行生命周期。" />
        <LoadError onRetry={() => void queryResult.refetch()} />
      </>
    );
  }
  if (queryResult.isPending) {
    return (
      <>
        <PageHeader title="帖子详情" description="逐帖透视一条情报的完整内容与跨运行生命周期。" />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  const { post, comments, events, insights } = queryResult.data;
  const srcMeta = SOURCE_META[post.source as RadarSourceKind];
  const SrcIcon = srcMeta?.icon;
  const translated = !!post.titleZh;
  const shownComments = countComments(comments);
  const recentEvents = events.slice(-TIMELINE_CAP); // 最近 N 条（升序，最新在底部）
  const misses = post.recheckMisses;

  const title = (tr.showZh ? tr.view.get(post.titleHash) : undefined) ?? post.title;
  const body = (tr.showZh ? tr.view.get(post.selftextHash) : undefined) ?? post.body;

  return (
    <>
      <PageHeader
        title="帖子详情"
        description={
          // 24rem = 右栏 22rem + 列间距 gap-x-8(2rem)：副标题止于左栏右沿、不压右栏上方，窄屏自动多行
          <span className="block lg:max-w-[calc(100%_-_24rem)]">
            左栏读完整内容（标题 / 正文 /
            评论），右栏看它的一生：复查退避节奏、跨运行轨迹与产出洞察。
          </span>
        }
        actions={
          <>
            {can(user, 'analyze:run') ? <InspectLaunchButton postId={post.id} /> : null}
            <TranslationButton t={tr} />
          </>
        }
      />

      <div className="grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* 左：读它 —— 完整内容 + 评论（无卡片，靠层级与留白分区）；译文视图向下传给评论树 */}
        <TranslationViewProvider value={tr.view}>
          <div className="min-w-0 space-y-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  {SrcIcon ? <SrcIcon className="size-3.5" /> : null}
                  {post.channel}
                </span>
                {post.author ? <span>u/{post.author}</span> : null}
                <span className="font-mono text-muted-foreground/60">{post.id}</span>
                {translated ? (
                  <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                    <Languages className="size-3" />
                    {tr.showZh ? '已译' : '原文'}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="px-1.5 py-0 text-[10px] text-muted-foreground/70"
                  >
                    未翻译
                  </Badge>
                )}
                <span className="ml-auto inline-flex items-center gap-3 tabular-nums">
                  <span className="inline-flex items-center gap-0.5">
                    <ArrowBigUp className="size-3.5" />
                    {post.score.toLocaleString()}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="size-3" />
                    {post.numComments}
                  </span>
                </span>
              </div>

              <h2 className="text-xl leading-snug font-semibold text-balance">{title}</h2>
              {post.body ? (
                <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                  {body}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground/60">链接帖 · 无正文</p>
              )}
            </div>

            {comments.length > 0 ? (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">
                  评论 <span className="tabular-nums">{shownComments}</span> 条
                  {shownComments < post.numComments ? (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · 源站共 {post.numComments}
                    </span>
                  ) : null}
                </h3>
                <div className="space-y-5">
                  {comments.map((cc) => (
                    <CommentNode key={cc.id} c={cc} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </TranslationViewProvider>

        {/* 右：它的一生 —— 复查状态 + 时间线 + 洞察（仅留左边界作最基础分区，sticky 侧栏） */}
        <div className="space-y-7 lg:sticky lg:top-20 lg:border-l lg:pl-8">
          <div className="space-y-2">
            <SectionLabel>复查状态</SectionLabel>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={misses === 0 ? 'default' : 'secondary'}>
                {misses === 0 ? '活跃' : `连续未变 ${misses} 次`}
              </Badge>
              <span className="text-muted-foreground">复查节奏 {intervalLabel(misses)}</span>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground">
              下次到期 sweep #{post.recheckDueSweep}
              {post.lastRecheckedAt ? ` · 上次复查 ${timeAgo(post.lastRecheckedAt)}` : ''}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>一生时间线（跨运行）</SectionLabel>
              {events.length > recentEvents.length ? (
                <span className="text-[11px] tabular-nums text-muted-foreground/60">
                  最近 {recentEvents.length} · 共 {events.length}
                </span>
              ) : null}
            </div>
            {recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground/70">
                暂无运行事件（被复查到或新采集的帖会出现在这里）。
              </p>
            ) : (
              <div>
                {recentEvents.map((ev, i) => (
                  <div key={ev.taskId} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          TASK_STATUS_META[ev.status]?.dot ?? 'bg-muted-foreground/30',
                        )}
                      />
                      {i < recentEvents.length - 1 ? (
                        <span className="my-0.5 w-px flex-1 bg-border" />
                      ) : null}
                    </div>
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pb-3 text-sm">
                      <Link
                        to={`/radar/runs/${ev.runId}`}
                        className="min-w-0 truncate hover:text-primary"
                      >
                        {eventLabel(ev)}
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {timeAgo(ev.at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {insights.length > 0 ? (
            <div className="space-y-2.5">
              <SectionLabel>产出洞察（{insights.length}）</SectionLabel>
              <div className="space-y-0.5">
                {insights.map((ins) => (
                  <Link
                    key={ins.id}
                    to={`/radar/insights?q=${encodeURIComponent(ins.painPoint)}`}
                    className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        INTENSITY_META[ins.intensity].bar,
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {ins.painPoint}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
                      机会 {ins.oppCount}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function PostsPage() {
  return (
    <RequirePerm perm="analyze:run">
      <PostDetailView />
    </RequirePerm>
  );
}
