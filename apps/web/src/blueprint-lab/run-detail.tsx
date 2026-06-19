/**
 * 运行详情页（原型，mock 数据）：一条运行的下钻视图。
 * 路由 /processes/:id/runs/:runId，从运行记录列表的某一行点入（序号经 location.state 传入）。
 *
 * 布局：桌面定高（lg:h-[calc(100svh-7rem)]，对齐外壳 topbar 56 + 内容 py-6 48）填满视口、避免页面滚动；
 * 左为任务血缘星图（[run-constellation.tsx](./run-constellation)，L2 任务 + L3 环节同框），
 * 右为侧栏（选中任务的帖子卡 + 环节列表 + 选中环节的产物 L4，评论环节展开评论树），内容超出时侧栏内部滚动。
 * 面包屑（顶栏）已延伸到「进程 / 运行记录 / 运行详情」，故页内不再放返回箭头。
 */
import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowBigUp, Layers, Lock, MessageSquare } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { toast } from '@hatch-radar/ui/components/sonner';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { SOURCE_META, TASK_KIND_META, TASK_STATUS_META } from './constants';
import { mockApi } from './mock';
import { RunConstellation } from './run-constellation';
import type { MockComment, MockPost, StageStatus, Task } from './types';
import { KEYS, relTime } from './util';

const STAGE_DOT: Record<StageStatus, string> = {
  done: 'bg-muted-foreground',
  running: 'bg-primary',
  paused: 'bg-intensity-medium',
  failed: 'bg-intensity-high',
  skipped: 'bg-muted-foreground/30',
  pending: 'bg-muted-foreground/25',
};
const STAGE_LABEL: Record<StageStatus, string> = {
  done: '完成',
  running: '运行中',
  paused: '暂停',
  failed: '失败',
  skipped: '略过',
  pending: '待执行',
};

/** 按环节状态给出可用控制（原型：仅 toast，不接后端）。 */
function controlsFor(s: StageStatus): { label: string; primary?: boolean }[] {
  if (s === 'paused')
    return [{ label: '放行下一步', primary: true }, { label: '运行到底' }, { label: '取消' }];
  if (s === 'failed') return [{ label: '重试本环节', primary: true }, { label: '取消' }];
  if (s === 'running') return [{ label: '取消' }];
  return [];
}

/** 计算评论预览树的节点数（用于「其余已折叠」提示）。 */
function countComments(nodes: MockComment[]): number {
  let n = 0;
  for (const c of nodes) n += 1 + (c.children ? countComments(c.children) : 0);
  return n;
}

/** 一条评论（递归渲染，子评论左缩进 + 竖线，体现层级深浅）。 */
function CommentNode({ c }: { c: MockComment }) {
  return (
    <div className="space-y-1">
      <div className="text-xs">
        <span className="font-medium text-foreground">u/{c.author}</span>
        <span className="text-muted-foreground"> · ↑{c.score}</span>
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

/** 帖子卡：来源/频道 + 标题 + 正文 + 作者/分数/评论数/最深层级。 */
function PostCard({ post }: { post: MockPost }) {
  const SrcIcon = SOURCE_META[post.source].icon;
  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <SrcIcon className="size-3.5" />
          {post.channel}
        </span>
        <span className="ml-auto">{relTime(Date.now() - post.ageMinutes * 60_000)}</span>
      </div>
      <p className="text-sm font-medium leading-snug">{post.title}</p>
      {post.body ? (
        <p className="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
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
            <Layers className="size-3" />
            最深 {post.commentDepth} 层
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** 选中任务面板：帖子卡 + 环节列表 + 选中环节的产物（评论环节展开评论树）+ 控制条。 */
function TaskPanel({
  task,
  stageSeq,
  onSelectStage,
}: {
  task: Task;
  stageSeq: number | null;
  onSelectStage: (seq: number | null) => void;
}) {
  const meta = TASK_STATUS_META[task.status];
  const stage = stageSeq != null ? task.stages[stageSeq] : undefined;
  const post = task.post;
  const isCommentStage =
    stage != null && (stage.name === 'fetch_comments' || stage.name === 'recrawl');
  const shownComments = post ? countComments(post.comments) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 pr-7">
        <span className="text-sm font-medium">{TASK_KIND_META[task.kind].label}</span>
        {post ? <span className="font-mono text-xs text-muted-foreground">{post.id}</span> : null}
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      {post ? <PostCard post={post} /> : null}

      <div>
        <div className="mb-1 text-xs text-muted-foreground">环节</div>
        <div className="space-y-0.5">
          {task.stages.map((s) => (
            <button
              key={s.seq}
              type="button"
              onClick={() => onSelectStage(s.seq)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent ${
                stageSeq === s.seq ? 'bg-accent' : ''
              }`}
            >
              <span className={`size-2 shrink-0 rounded-full ${STAGE_DOT[s.status]}`} />
              <span className="font-mono">{s.name}</span>
              {s.gate ? (
                <Lock className="size-3 shrink-0 text-intensity-medium" aria-label="闸门" />
              ) : null}
              <span className="ml-auto shrink-0 text-muted-foreground">
                {STAGE_LABEL[s.status]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {stage ? (
        <div className="rounded-md border bg-background p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            产物 · <span className="font-mono">{stage.name}</span>
            {stage.name === 'ai_call' ? (
              <span className="text-intensity-high">· 不可重算</span>
            ) : null}
          </div>
          {stage.error ? (
            <p className="text-sm text-destructive">{stage.error}</p>
          ) : isCommentStage && post && post.comments.length > 0 ? (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">{stage.output}</p>
              <div className="space-y-2 border-l pl-2.5">
                {post.comments.map((c, i) => (
                  <CommentNode key={i} c={c} />
                ))}
              </div>
              {post.numComments > shownComments ? (
                <p className="mt-2 text-xs text-muted-foreground/60">
                  … 其余 {post.numComments - shownComments} 条已折叠
                </p>
              ) : null}
            </div>
          ) : stage.output ? (
            <p className="text-sm text-muted-foreground">{stage.output}</p>
          ) : (
            <p className="text-sm text-muted-foreground/70">尚未产出（环节未执行）。</p>
          )}
          {controlsFor(stage.status).length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {controlsFor(stage.status).map((c) => (
                <Button
                  key={c.label}
                  size="sm"
                  variant={c.primary ? 'default' : 'outline'}
                  onClick={() => toast.info(`原型：「${c.label}」未接后端`)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/70">点上方某个环节查看其产物。</p>
      )}
    </div>
  );
}

function RunDetailView() {
  const { runId = '' } = useParams();
  const location = useLocation();
  const ordinal = (location.state as { ordinal?: number } | null)?.ordinal ?? null;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [stageSeq, setStageSeq] = useState<number | null>(null);

  const q = useQuery({
    queryKey: KEYS.runDetail(runId),
    queryFn: () => mockApi.getRunDetail(runId),
  });

  const selectTask = (tid: string | null): void => {
    setSelectedTaskId(tid);
    setStageSeq(null);
  };

  if (q.isError) return <LoadError onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (!q.data) return <EmptyState title="运行不存在" hint="它可能已被清理。返回运行记录看看。" />;

  const { run, tasks } = q.data;
  const selectedTask = selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? null) : null;

  // 整页 = 全画布；概要 / 工具栏 / 图例 / 选中面板均由画布上层 overlay 承载（见 RunConstellation）。
  return (
    <div className="h-[calc(100svh-7rem)] w-full">
      <RunConstellation
        run={run}
        tasks={tasks}
        ordinal={ordinal}
        selectedId={selectedTaskId}
        stageSeq={stageSeq}
        onSelectTask={selectTask}
        onSelectStage={setStageSeq}
        panel={
          selectedTask ? (
            <TaskPanel task={selectedTask} stageSeq={stageSeq} onSelectStage={setStageSeq} />
          ) : null
        }
      />
    </div>
  );
}

/** 运行详情页（原型）。沿用 analyze:run 能力。 */
export function RunDetailPage() {
  return (
    <RequirePerm perm="analyze:run">
      <RunDetailView />
    </RequirePerm>
  );
}
