/**
 * 帖子详情（/radar/posts/:id）—— 一页讲一条帖：左读它、右看它的命运。
 *
 * 无卡片设计：靠排版层级与留白分区（不再用带边框的卡片包裹），弱化板块边界感。
 * 左（读它）：完整内容 —— 标题 / 正文 / 多级评论树（译文优先；评论加大字号 + 明显层级缩进）。
 * 右（它的一生，sticky 侧栏）：复查状态（退避节奏）+ 跨运行时间线（最近 N 条）+ 产出洞察。
 * PageHeader 有「译文 / 原文」全局切换（仅当该帖有译文时显示）；缺 :id 兜底最近一条。
 * 模拟时钟（调试工具）在全局 TopBar（/radar 段常驻），此页不自带。
 */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowBigUp, Languages, Layers, MessageSquare } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { commentAvatarDataUri } from '@/lib/avatar';
import { INTENSITY_META, SOURCE_META, TASK_STATUS_META } from './constants';
import { setPreferOriginal, useLang, useWorld } from './store';
import type { Comment, Task, World } from './types';
import { isTranslated, relPast, tText } from './util';

const CAP = 16;
const TIMELINE_CAP = 10; // 一生时间线只显示最近 N 条事件

function recheckSweepOf(w: World): number {
  return w.processes.reduce((mx, p) => {
    const b = w.blueprints.find((x) => x.id === p.blueprintId);
    return b?.kind === 'recheck' ? Math.max(mx, p.sweepSeq) : mx;
  }, 0);
}

function intervalLabel(misses: number): string {
  if (misses <= 0) return '每轮查';
  return `隔 ${Math.min(2 ** (misses - 1), CAP)} 轮`;
}

function eventLabel(task: Task, sweep: number | null): string {
  if (task.kind === 'collect') return '采集入库';
  if (task.kind === 'analyze') {
    if (task.status === 'failed') return 'AI 分析失败';
    if (task.status === 'succeeded') return 'AI 分析 → 产出洞察';
    return 'AI 分析中';
  }
  if (task.kind === 'recheck') {
    const s = sweep != null ? `复查 #${sweep}` : '复查';
    if (task.status === 'skipped') return `${s} · 未变化（退避）`;
    if (task.status === 'succeeded') return `${s} · 有变化 → 重抓`;
    if (task.status === 'failed') return `${s} · 失败`;
    return `${s} · 进行中`;
  }
  return task.kind;
}

function countComments(nodes: Comment[]): number {
  let n = 0;
  for (const x of nodes) n += 1 + (x.children ? countComments(x.children) : 0);
  return n;
}

function select(w: World, id: string | undefined) {
  const sweep = recheckSweepOf(w);
  const post =
    (id ? w.posts.find((p) => p.id === id) : undefined) ?? w.posts[w.posts.length - 1] ?? null;
  if (!post)
    return {
      post: null,
      sweep,
      nowMs: w.nowMs,
      events: [],
      eventsTotal: 0,
      insights: [],
      misses: 0,
      due: 0,
    };
  const allEvents = w.tasks
    .filter((t) => t.postId === post.id)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt)
    .map((t) => ({
      task: t,
      sweep: w.runs.find((r) => r.id === t.runId)?.sweepSeq ?? null,
      at: t.finishedAt ?? t.enqueuedAt,
    }));
  return {
    post,
    sweep,
    events: allEvents.slice(-TIMELINE_CAP), // 最近 N 条（升序，最新在底部）
    eventsTotal: allEvents.length,
    insights: w.insights.filter((i) => i.postId === post.id),
    misses: post.recheckMisses ?? 0,
    due: post.recheckDueSweep ?? 0,
    nowMs: w.nowMs,
  };
}

/** 全局「译文 / 原文」切换（处处生效）。 */
function LangToggle() {
  const preferOriginal = useLang();
  return (
    <div className="inline-flex overflow-hidden rounded-md border text-xs">
      <button
        type="button"
        onClick={() => setPreferOriginal(false)}
        className={cn(
          'px-2 py-1',
          !preferOriginal ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
        )}
      >
        译文
      </button>
      <button
        type="button"
        onClick={() => setPreferOriginal(true)}
        className={cn(
          'border-l px-2 py-1',
          preferOriginal ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
        )}
      >
        原文
      </button>
    </div>
  );
}

/** 一条评论：加大正文字号、层级以更明显的缩进 + 左侧轨道线表达。 */
function CommentNode({
  c,
  preferOriginal,
  nowMs,
}: {
  c: Comment;
  preferOriginal: boolean;
  nowMs: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <img
          src={commentAvatarDataUri(c.author)}
          alt=""
          aria-hidden
          className="size-5 shrink-0 rounded-full bg-muted"
        />
        <span className="font-medium text-foreground">u/{c.author}</span>
        <span className="text-muted-foreground">· ↑{c.score}</span>
        {c.ageMinutes != null ? (
          <span className="text-muted-foreground/70">
            · {relPast(nowMs - c.ageMinutes * 60_000, nowMs)}
          </span>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {tText(c.body, c.bodyZh, preferOriginal)}
      </p>
      {c.children && c.children.length > 0 ? (
        <div className="mt-3 space-y-4 border-l-2 border-border pl-5">
          {c.children.map((ch, i) => (
            <CommentNode key={i} c={ch} preferOriginal={preferOriginal} nowMs={nowMs} />
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
  const { id } = useParams();
  const preferOriginal = useLang();
  const d = useWorld((w) => select(w, id));

  if (!d.post) {
    return (
      <>
        <PageHeader title="帖子" description="逐帖透视一条情报的完整内容与跨运行生命周期。" />
        <EmptyState title="还没有帖子" hint="等采集跑起来，从洞察库或运行详情里点一条帖子进来。" />
      </>
    );
  }

  const post = d.post;
  const SrcIcon = SOURCE_META[post.source].icon;
  const translated = isTranslated(post);
  const shownComments = countComments(post.comments);

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
        actions={translated ? <LangToggle /> : undefined}
      />

      <div className="grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* 左：读它 —— 完整内容 + 评论（无卡片，靠层级与留白分区） */}
        <div className="min-w-0 space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <SrcIcon className="size-3.5" />
                {post.channel}
              </span>
              <span>u/{post.author}</span>
              <span className="font-mono text-muted-foreground/60">{post.id}</span>
              {translated ? (
                <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                  <Languages className="size-3" />
                  {preferOriginal ? '原文' : '已译'}
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
                {post.commentDepth > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3" />
                    {post.commentDepth} 层
                  </span>
                ) : null}
              </span>
            </div>

            <h2 className="text-xl leading-snug font-semibold text-balance">
              {tText(post.title, post.titleZh, preferOriginal)}
            </h2>
            {post.body ? (
              <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                {tText(post.body, post.bodyZh, preferOriginal)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/60">链接帖 · 无正文</p>
            )}
          </div>

          {post.comments.length > 0 ? (
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
                {post.comments.map((cc, i) => (
                  <CommentNode key={i} c={cc} preferOriginal={preferOriginal} nowMs={d.nowMs} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* 右：它的一生 —— 复查状态 + 时间线 + 洞察（仅留左边界作最基础分区，sticky 侧栏） */}
        <div className="space-y-7 lg:sticky lg:top-20 lg:border-l lg:pl-8">
          <div className="space-y-2">
            <SectionLabel>复查状态</SectionLabel>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={d.misses === 0 ? 'default' : 'secondary'}>
                {d.misses === 0 ? '活跃' : `连续未变 ${d.misses} 次`}
              </Badge>
              <span className="text-muted-foreground">复查节奏 {intervalLabel(d.misses)}</span>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground">
              下次到期 sweep #{d.due} · 当前 #{d.sweep}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>一生时间线（跨运行）</SectionLabel>
              {d.eventsTotal > d.events.length ? (
                <span className="text-[11px] tabular-nums text-muted-foreground/60">
                  最近 {d.events.length} · 共 {d.eventsTotal}
                </span>
              ) : null}
            </div>
            {d.events.length === 0 ? (
              <p className="text-sm text-muted-foreground/70">
                本会话暂无运行事件（被复查到或新采集的帖会出现在这里）。
              </p>
            ) : (
              <div>
                {d.events.map(({ task, sweep, at }, i) => (
                  <div key={task.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          TASK_STATUS_META[task.status].dot,
                        )}
                      />
                      {i < d.events.length - 1 ? (
                        <span className="my-0.5 w-px flex-1 bg-border" />
                      ) : null}
                    </div>
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pb-3 text-sm">
                      <Link
                        to={`/radar/runs/${task.runId}`}
                        className="min-w-0 truncate hover:text-primary"
                      >
                        {eventLabel(task, sweep)}
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {relPast(at, d.nowMs)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {d.insights.length > 0 ? (
            <div className="space-y-2.5">
              <SectionLabel>产出洞察（{d.insights.length}）</SectionLabel>
              <div className="space-y-0.5">
                {d.insights.map((ins) => (
                  <Link
                    key={ins.id}
                    to={`/radar/runs/${ins.runId}`}
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
                      痛 {ins.painCount} · 机 {ins.oppCount}
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
