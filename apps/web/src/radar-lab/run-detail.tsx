/**
 * 运行详情（/radar/runs/:runId）—— 一条运行的实时下钻 + 逐环节操控。
 *
 * 左：任务血缘树（discover→collect→analyze / recheck→analyze），实时逐环节点亮、计数在涨。
 * 右：选中任务的帖子卡 + 环节列表（可挂/摘闸门）+ 选中环节产物（评论环节展开评论树）+ 控制条。
 * 控制（放行下一步 / 运行到底 / 重试 / 取消）**真改 world**，跨页即时可见。
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowBigUp, Layers, Lock, LockOpen, MessageSquare } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Card } from '@hatch-radar/ui/components/card';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { commentAvatarDataUri } from '@/lib/avatar';
import { ClockBar } from './clock-bar';
import {
  RUN_STATUS_META,
  SOURCE_META,
  STAGE_STATUS_META,
  stageLabel,
  TASK_KIND_META,
  TASK_STATUS_META,
} from './constants';
import {
  cancelTask,
  releaseStage,
  retryStage,
  runToEnd,
  toggleGate,
  useWorld,
} from './store';
import type { Comment, Post, Stage, Task, World } from './types';
import { relPast } from './util';

function selectRun(w: World, runId: string) {
  const run = w.runs.find((r) => r.id === runId);
  if (!run) return null;
  const process = w.processes.find((p) => p.id === run.processId) ?? null;
  const blueprint = w.blueprints.find((b) => b.id === run.blueprintId) ?? null;
  const tasks = w.tasks.filter((t) => t.runId === runId);

  // 血缘树：按 parentId 展开，记深度
  const byParent = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = t.parentId ?? '__root';
    const arr = byParent.get(k);
    if (arr) arr.push(t);
    else byParent.set(k, [t]);
  }
  const tree: { task: Task; depth: number }[] = [];
  const walk = (key: string, depth: number): void => {
    const kids = (byParent.get(key) ?? []).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    for (const t of kids) {
      tree.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk('__root', 0);

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'succeeded' || t.status === 'skipped').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  return { run, process, blueprint, tree, total, done, failed, nowMs: w.nowMs };
}

// ─── 任务树行 ──────────────────────────────────────────────────────────────────

function StageDots({ stages }: { stages: Stage[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {stages.map((s) => (
        <span
          key={s.seq}
          className={cn('size-1.5 rounded-full', STAGE_STATUS_META[s.status].dot)}
          title={`${stageLabel(s.name)} · ${STAGE_STATUS_META[s.status].label}`}
        />
      ))}
    </span>
  );
}

function TaskRow({
  task,
  depth,
  selected,
  onSelect,
}: {
  task: Task;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = TASK_KIND_META[task.kind];
  const Icon = meta.icon;
  const st = TASK_STATUS_META[task.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-accent',
        selected && 'bg-accent',
      )}
    >
      <span
        className={cn('size-1.5 shrink-0 rounded-full', task.status === 'running' && 'signal-pulse', st.dot)}
      />
      <Icon className={cn('size-4 shrink-0', meta.color)} />
      <span className="shrink-0 font-medium">{meta.label}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {task.post ? task.post.title : '列表发现 + 去重 + 派生'}
      </span>
      <StageDots stages={task.stages} />
      <Badge variant={st.variant} className="shrink-0">
        {st.label}
      </Badge>
    </button>
  );
}

// ─── 帖子卡 + 评论树 ───────────────────────────────────────────────────────────

function CommentNode({ c }: { c: Comment }) {
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
      <p className="text-xs leading-relaxed text-muted-foreground">{c.body}</p>
      {c.children && c.children.length > 0 ? (
        <div className="mt-1.5 space-y-2 border-l pl-2.5">
          {c.children.map((ch, i) => (
            <CommentNode key={i} c={ch} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PostCard({ post, nowMs }: { post: Post; nowMs: number }) {
  const Icon = SOURCE_META[post.source].icon;
  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <Icon className="size-3.5" />
          {post.channel}
        </span>
        <span className="ml-auto">{relPast(nowMs - post.ageMinutes * 60_000, nowMs)}</span>
      </div>
      <p className="text-sm leading-snug font-medium">{post.title}</p>
      {post.body ? (
        <p className="max-h-32 overflow-y-auto text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
          {post.body}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/60">链接帖 · 无正文</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>u/{post.author}</span>
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
            <Layers className="size-3" />最深 {post.commentDepth} 层
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── 选中任务面板 ───────────────────────────────────────────────────────────────

function controlsFor(task: Task): { label: string; primary?: boolean; run: () => void }[] {
  if (task.status === 'paused')
    return [
      { label: '放行下一步', primary: true, run: () => releaseStage(task.id) },
      { label: '运行到底', run: () => runToEnd(task.id) },
      { label: '取消', run: () => cancelTask(task.id) },
    ];
  if (task.status === 'failed')
    return [
      { label: '重试本环节', primary: true, run: () => retryStage(task.id) },
      { label: '取消', run: () => cancelTask(task.id) },
    ];
  if (task.status === 'running' || task.status === 'queued')
    return [{ label: '取消', run: () => cancelTask(task.id) }];
  return [];
}

function TaskPanel({ task, nowMs }: { task: Task; nowMs: number }) {
  const [seq, setSeq] = useState<number | null>(null);
  const meta = TASK_STATUS_META[task.status];
  const kindMeta = TASK_KIND_META[task.kind];
  const stage = seq != null ? task.stages.find((s) => s.seq === seq) : undefined;
  const isComments = stage != null && (stage.name === 'fetch_comments' || stage.name === 'recrawl');
  const controls = controlsFor(task);

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <kindMeta.icon className={cn('size-4', kindMeta.color)} />
        <span className="text-sm font-medium">{kindMeta.label}</span>
        {task.post ? <span className="font-mono text-xs text-muted-foreground">{task.post.id}</span> : null}
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      {task.post ? <PostCard post={task.post} nowMs={nowMs} /> : null}

      <div>
        <div className="mb-1 text-xs text-muted-foreground">环节（点闸门图标可挂/摘）</div>
        <div className="space-y-0.5">
          {task.stages.map((s) => {
            const canGate = s.status === 'pending';
            return (
              <div
                key={s.seq}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                  seq === s.seq ? 'bg-accent' : '',
                )}
              >
                <span className={cn('size-2 shrink-0 rounded-full', s.status === 'running' && 'signal-pulse', STAGE_STATUS_META[s.status].dot)} />
                <button type="button" onClick={() => setSeq(s.seq)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="shrink-0">{stageLabel(s.name)}</span>
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/60">{s.name}</span>
                </button>
                <button
                  type="button"
                  disabled={!canGate}
                  onClick={() => toggleGate(task.id, s.seq)}
                  aria-label={s.gate ? '摘闸门' : '挂闸门'}
                  className={cn('shrink-0', canGate ? 'hover:text-foreground' : 'cursor-default opacity-40')}
                >
                  {s.gate ? (
                    <Lock className="size-3.5 text-intensity-medium" />
                  ) : (
                    <LockOpen className="size-3.5 text-muted-foreground/50" />
                  )}
                </button>
                <span className="w-12 shrink-0 text-right text-muted-foreground">
                  {STAGE_STATUS_META[s.status].label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {stage ? (
        <div className="rounded-md border bg-background p-3 text-sm">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            产物 · <span className="text-foreground">{stageLabel(stage.name)}</span>
            {stage.name === 'ai_call' ? <span className="text-intensity-high">· 不可重算</span> : null}
          </div>
          {stage.error ? (
            <p className="text-destructive">{stage.error}</p>
          ) : isComments && task.post && task.post.comments.length > 0 ? (
            <div className="space-y-2 border-l pl-2.5">
              {task.post.comments.map((c, i) => (
                <CommentNode key={i} c={c} />
              ))}
            </div>
          ) : stage.output ? (
            <p className="text-muted-foreground">{stage.output}</p>
          ) : (
            <p className="text-muted-foreground/70">尚未产出（环节未执行）。</p>
          )}
        </div>
      ) : null}

      {controls.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {controls.map((c) => (
            <Button key={c.label} size="sm" variant={c.primary ? 'default' : 'outline'} onClick={c.run}>
              {c.label}
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

// ─── 页面 ──────────────────────────────────────────────────────────────────────

function RunDetailView() {
  const { runId = '' } = useParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const data = useWorld((w) => selectRun(w, runId));

  if (!data) return <EmptyState title="运行不存在" hint="它可能已被清理。返回指挥室看看。" />;
  const { run, process, tree, total, done, failed, nowMs } = data;
  const selected = selectedId ? (tree.find((n) => n.task.id === selectedId)?.task ?? null) : null;
  const rm = RUN_STATUS_META[run.status];

  return (
    <>
      <PageHeader
        title={`运行 · ${process?.label ?? run.processId}`}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Badge variant={rm.variant}>{rm.label}</Badge>
            {run.sweepSeq != null ? <span className="text-muted-foreground">sweep #{run.sweepSeq}</span> : null}
            <span className="text-muted-foreground">
              任务 {done}/{total}
              {failed > 0 ? <span className="text-destructive"> · 失败 {failed}</span> : null}
            </span>
            <span className="text-muted-foreground">· {relPast(run.startedAt, nowMs)}起</span>
          </span>
        }
        actions={<ClockBar />}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <Card className="p-2">
          {tree.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">任务派生中…</p>
          ) : (
            tree.map(({ task, depth }) => (
              <TaskRow
                key={task.id}
                task={task}
                depth={depth}
                selected={selectedId === task.id}
                onSelect={() => setSelectedId(task.id)}
              />
            ))
          )}
        </Card>
        <div className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <TaskPanel task={selected} nowMs={nowMs} />
          ) : (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">点左侧某个任务，查看它的帖子、逐环节产物与控制。</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export function RadarRunDetailPage() {
  return (
    <RequirePerm perm="analyze:run">
      <RunDetailView />
    </RequirePerm>
  );
}
