/**
 * 帖子详情（/radar/posts/:id）—— 完整内容 + 跨运行一生。
 *
 * 上：完整内容（标题 / 正文 / 评论树 / 元信息）——**译文优先**显示，PageHeader 有「译文 / 原文」全局切换。
 * 下：一生（复查状态 + 跨运行时间线：采集→复查〔退避〕→重分析→洞察）。
 * 一页讲一条帖：读它 + 看它的命运。入口：收成洞察、运行详情的帖子卡点进；缺 :id 兜底最近一条。
 */
import { Link, useParams } from 'react-router-dom';
import { ArrowBigUp, Languages, Layers, MessageSquare } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Card } from '@hatch-radar/ui/components/card';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { commentAvatarDataUri } from '@/lib/avatar';
import { ClockBar } from './clock-bar';
import { INTENSITY_META, SOURCE_META, TASK_STATUS_META } from './constants';
import { setPreferOriginal, useLang, useWorld } from './store';
import type { Comment, Task, World } from './types';
import { isTranslated, relPast, tText } from './util';

const CAP = 16;

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

function select(w: World, id: string | undefined) {
  const sweep = recheckSweepOf(w);
  const post = (id ? w.posts.find((p) => p.id === id) : undefined) ?? w.posts[w.posts.length - 1] ?? null;
  if (!post) return { post: null, sweep, nowMs: w.nowMs, events: [], insights: [], misses: 0, due: 0 };
  const events = w.tasks
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
    events,
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
        className={cn('px-2 py-1', !preferOriginal ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground')}
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

function CommentNode({ c, preferOriginal }: { c: Comment; preferOriginal: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        <img
          src={commentAvatarDataUri(c.author)}
          alt=""
          aria-hidden
          className="size-4 shrink-0 rounded-full bg-muted"
        />
        <span className="font-medium text-foreground">u/{c.author}</span>
        <span className="text-muted-foreground">· ↑{c.score}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{tText(c.body, c.bodyZh, preferOriginal)}</p>
      {c.children && c.children.length > 0 ? (
        <div className="mt-1.5 space-y-2 border-l pl-2.5">
          {c.children.map((ch, i) => (
            <CommentNode key={i} c={ch} preferOriginal={preferOriginal} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PostDetailView() {
  const { id } = useParams();
  const preferOriginal = useLang();
  const d = useWorld((w) => select(w, id));

  if (!d.post) {
    return (
      <>
        <PageHeader title="帖子" description="完整内容 + 跨运行一生。" actions={<ClockBar />} />
        <EmptyState title="还没有帖子" hint="等采集跑起来，从收成或运行详情里点一条帖子进来。" />
      </>
    );
  }

  const post = d.post;
  const SrcIcon = SOURCE_META[post.source].icon;
  const translated = isTranslated(post);

  return (
    <>
      <PageHeader
        title="帖子"
        description="完整内容 + 跨运行一生（采集 → 复查〔退避〕→ 重分析 → 洞察）。"
        actions={
          <div className="flex items-center gap-2">
            {translated ? <LangToggle /> : null}
            <ClockBar />
          </div>
        }
      />
      <div className="mx-auto max-w-3xl space-y-4">
        {/* 完整内容（译文优先） */}
        <Card className="gap-3 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <SrcIcon className="size-3.5" />
              {post.channel}
            </span>
            <span className="font-mono">{post.id}</span>
            {translated ? (
              <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                <Languages className="size-3" />
                {preferOriginal ? '原文' : '已译'}
              </Badge>
            ) : (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground/70">
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
          <p className="text-base leading-snug font-semibold">{tText(post.title, post.titleZh, preferOriginal)}</p>
          {post.body ? (
            <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
              {tText(post.body, post.bodyZh, preferOriginal)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/60">链接帖 · 无正文</p>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
            <span className="text-muted-foreground">作者 u/{post.author}</span>
            <Badge variant={d.misses === 0 ? 'default' : 'secondary'}>
              {d.misses === 0 ? '活跃' : `连续未变 ${d.misses} 次`}
            </Badge>
            <span className="text-muted-foreground">复查节奏 {intervalLabel(d.misses)}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              下次到期 sweep #{d.due} · 当前 #{d.sweep}
            </span>
          </div>
        </Card>

        {/* 评论树 */}
        {post.comments.length > 0 ? (
          <Card className="gap-2 p-4">
            <h2 className="text-sm font-semibold">评论（采样 {post.numComments} 条）</h2>
            <div className="space-y-2.5">
              {post.comments.map((cc, i) => (
                <CommentNode key={i} c={cc} preferOriginal={preferOriginal} />
              ))}
            </div>
          </Card>
        ) : null}

        {/* 一生时间线 */}
        <Card className="gap-2 p-4">
          <h2 className="text-sm font-semibold">一生时间线（跨运行）</h2>
          {d.events.length === 0 ? (
            <p className="text-sm text-muted-foreground/70">本会话暂无运行事件（被复查到或新采集的帖会出现在这里）。</p>
          ) : (
            <div className="mt-1">
              {d.events.map(({ task, sweep, at }, i) => (
                <div key={task.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn('mt-1.5 size-2 shrink-0 rounded-full', TASK_STATUS_META[task.status].dot)}
                    />
                    {i < d.events.length - 1 ? <span className="my-0.5 w-px flex-1 bg-border" /> : null}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pb-3 text-sm">
                    <Link to={`/radar/runs/${task.runId}`} className="min-w-0 truncate hover:text-primary">
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
        </Card>

        {/* 产出洞察 */}
        {d.insights.length > 0 ? (
          <Card className="gap-2 p-4">
            <h2 className="text-sm font-semibold">产出洞察（{d.insights.length}）</h2>
            <div className="space-y-1.5">
              {d.insights.map((ins) => (
                <Link
                  key={ins.id}
                  to={`/radar/runs/${ins.runId}`}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', INTENSITY_META[ins.intensity].bar)} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{ins.painPoint}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
                    痛 {ins.painCount} · 机 {ins.oppCount}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        ) : null}
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
