import { type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@hatch-radar/ui/components/dialog';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { fmtDate, fmtDuration, parsePage, timeAgo } from '@/lib/format';
import { buildQuery } from '@/lib/qs';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
type JobTrigger = 'auto' | 'manual';

/** 队列任务行（投影自后端 /analysis/jobs/list 的 JobView） */
interface QueueJob {
  id: number;
  post_id: string;
  post_title: string | null;
  model: string;
  trigger: JobTrigger;
  status: JobStatus;
  attempts: number;
  error: string | null;
  enqueued_at: number;
  started_at: number | null;
  finished_at: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_write_tokens: number | null;
  cache_read_tokens: number | null;
  /** 展示期按 provider 单价 + 缓存倍率折算的成本（美元）；无单价/未采集 token 时为 null */
  cost: number | null;
}

interface JobStats {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  canceled: number;
}

/** GET /api/analysis/jobs/list：汇总 + 分页明细 */
interface JobsListResponse {
  stats: JobStats;
  items: QueueJob[];
  total: number;
  page: number;
  pageCount: number;
}

const STATUS_META: Record<
  JobStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  queued: { label: '排队', variant: 'outline' },
  running: { label: '运行中', variant: 'default' },
  succeeded: { label: '成功', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '已取消', variant: 'outline' },
};

const ALL_STATUSES: JobStatus[] = ['queued', 'running', 'succeeded', 'failed', 'canceled'];

/** 状态筛选标签（含计数 key） */
const STATUS_FILTERS: { value: JobStatus | null; label: string; key?: keyof JobStats }[] = [
  { value: null, label: '全部' },
  { value: 'queued', label: '排队', key: 'queued' },
  { value: 'running', label: '运行中', key: 'running' },
  { value: 'succeeded', label: '成功', key: 'succeeded' },
  { value: 'failed', label: '失败', key: 'failed' },
  { value: 'canceled', label: '已取消', key: 'canceled' },
];

const TRIGGER_FILTERS: { value: JobTrigger | null; label: string }[] = [
  { value: null, label: '全部来源' },
  { value: 'auto', label: '自动' },
  { value: 'manual', label: '手动' },
];

/** 排队等待（秒）：从入队到开始；仍在排队时为「至今」。无法判定返回 null */
function waitSeconds(j: QueueJob, now: number): number | null {
  const end = j.started_at ?? (j.status === 'queued' ? now : null);
  return end == null ? null : Math.max(0, end - j.enqueued_at);
}

/** 执行耗时（秒）：从开始到结束；运行中时为「至今」。未开始返回 null */
function execSeconds(j: QueueJob, now: number): number | null {
  if (j.started_at == null) return null;
  const end = j.finished_at ?? (j.status === 'running' ? now : null);
  return end == null ? null : Math.max(0, end - j.started_at);
}

/** 成本（美元）→ 紧凑展示，如 '$0.0123' / '$1.20' */
function fmtCost(cost: number): string {
  return `$${cost < 1 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

/** 任务时间标签：按状态取最相关时间戳折相对时间 */
function jobTimeLabel(j: QueueJob): string {
  if (j.status === 'queued') return `入队 ${timeAgo(j.enqueued_at)}`;
  if (j.status === 'running')
    return j.started_at ? `运行 ${timeAgo(j.started_at)}` : `入队 ${timeAgo(j.enqueued_at)}`;
  return j.finished_at ? timeAgo(j.finished_at) : timeAgo(j.enqueued_at);
}

/** 详情弹窗一行 */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** 任务详情弹窗：完整时间线、耗时、尝试与错误 */
function JobDetailDialog({
  job,
  now,
  onClose,
}: {
  job: QueueJob | null;
  now: number;
  onClose: () => void;
}) {
  const wait = job ? waitSeconds(job, now) : null;
  const exec = job ? execSeconds(job, now) : null;
  return (
    <Dialog open={job !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {job ? (
          <>
            <DialogHeader>
              <DialogTitle className="line-clamp-2">{job.post_title ?? job.post_id}</DialogTitle>
              <DialogDescription>任务 #{job.id} 的执行详情</DialogDescription>
            </DialogHeader>
            <div className="divide-y">
              <DetailRow label="状态">
                <Badge variant={STATUS_META[job.status].variant}>
                  {STATUS_META[job.status].label}
                </Badge>
              </DetailRow>
              <DetailRow label="模型">
                <span className="font-mono text-xs">{job.model}</span>
              </DetailRow>
              <DetailRow label="来源">{job.trigger === 'auto' ? '自动调度' : '手动运行'}</DetailRow>
              <DetailRow label="尝试次数">第 {job.attempts} 次</DetailRow>
              <DetailRow label="入队时间">{fmtDate(job.enqueued_at)}</DetailRow>
              <DetailRow label="开始时间">
                {job.started_at ? fmtDate(job.started_at) : '—'}
              </DetailRow>
              <DetailRow label="完成时间">
                {job.finished_at ? fmtDate(job.finished_at) : '—'}
              </DetailRow>
              <DetailRow label="排队等待">{wait != null ? fmtDuration(wait) : '—'}</DetailRow>
              <DetailRow label="执行耗时">
                {exec != null ? `${fmtDuration(exec)}${job.finished_at ? '' : '（进行中）'}` : '—'}
              </DetailRow>
              <DetailRow label="输入 token">
                {job.input_tokens != null ? job.input_tokens.toLocaleString() : '—'}
              </DetailRow>
              <DetailRow label="输出 token">
                {job.output_tokens != null ? job.output_tokens.toLocaleString() : '—'}
              </DetailRow>
              <DetailRow label="缓存写入">
                {job.cache_write_tokens != null ? job.cache_write_tokens.toLocaleString() : '—'}
              </DetailRow>
              <DetailRow label="缓存命中">
                {job.cache_read_tokens != null ? job.cache_read_tokens.toLocaleString() : '—'}
              </DetailRow>
              <DetailRow label="成本">{job.cost != null ? fmtCost(job.cost) : '—'}</DetailRow>
              {job.error ? (
                <DetailRow label="错误">
                  <span className="text-destructive">{job.error}</span>
                </DetailRow>
              ) : null}
              <DetailRow label="帖子">
                <Link to={`/posts/${job.post_id}`} className="underline-offset-4 hover:underline">
                  查看原帖 →
                </Link>
              </DetailRow>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function QueueView() {
  const [sp] = useSearchParams();
  const statusRaw = sp.get('status');
  const status: JobStatus | undefined = ALL_STATUSES.includes(statusRaw as JobStatus)
    ? (statusRaw as JobStatus)
    : undefined;
  const triggerRaw = sp.get('trigger');
  const trigger: JobTrigger | undefined =
    triggerRaw === 'auto' || triggerRaw === 'manual' ? triggerRaw : undefined;
  const page = parsePage(sp.get('page'));
  const now = Math.floor(Date.now() / 1000);
  const [detailJob, setDetailJob] = useState<QueueJob | null>(null);

  const listQ = useQuery({
    queryKey: ['queue-jobs', status, trigger, page],
    queryFn: () =>
      api.get<JobsListResponse>(
        `/analysis/jobs/list${buildQuery({ status, trigger, page: page > 1 ? page : undefined })}`,
      ),
    refetchInterval: 3000,
    // 切筛选 / 翻页时保留上一次数据继续展示，直到新数据到达再平滑替换，避免骨架屏导致的布局闪烁
    placeholderData: keepPreviousData,
  });

  // 改筛选回到第 1 页，并保留另一个筛选维度
  function filterHref(patch: Record<string, string | undefined>): string {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    const s = next.toString();
    return s ? `/queue?${s}` : '/queue';
  }

  const data = listQ.data;
  const stats = data?.stats ?? null;
  const items = data?.items ?? [];
  const hasFilter = Boolean(status || trigger);

  return (
    <>
      <PageHeader
        title="任务队列"
        description="全系统分析任务（手动 + 自动调度）· 每 3 秒刷新 · 点击任意行看详情"
      />

      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = (f.value ?? undefined) === status;
            const count = f.key && stats ? stats[f.key] : undefined;
            return (
              <Button key={f.label} asChild variant={active ? 'secondary' : 'ghost'} size="sm">
                <Link to={filterHref({ status: f.value ?? undefined })}>
                  {f.label}
                  {count !== undefined ? (
                    <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>
                  ) : null}
                </Link>
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {TRIGGER_FILTERS.map((t) => {
            const active = (t.value ?? undefined) === trigger;
            return (
              <Button key={t.label} asChild variant={active ? 'secondary' : 'ghost'} size="sm">
                <Link to={filterHref({ trigger: t.value ?? undefined })}>{t.label}</Link>
              </Button>
            );
          })}
        </div>
      </div>

      {listQ.isError ? (
        <LoadError
          message={listQ.error instanceof ApiError ? listQ.error.message : undefined}
          onRetry={() => void listQ.refetch()}
        />
      ) : listQ.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : !data || items.length === 0 ? (
        <EmptyState
          title={hasFilter ? '没有符合条件的任务' : '队列暂无任务'}
          hint={
            hasFilter
              ? '试试切换筛选条件。'
              : '在「分析」页选帖运行，或等定时调度入队后这里会出现任务。'
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">状态</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead className="w-40">模型</TableHead>
                  <TableHead className="w-16">来源</TableHead>
                  <TableHead className="w-28">耗时</TableHead>
                  <TableHead className="w-24">成本</TableHead>
                  <TableHead className="w-32">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((j) => {
                  const exec = execSeconds(j, now);
                  return (
                    <TableRow key={j.id} className="cursor-pointer" onClick={() => setDetailJob(j)}>
                      <TableCell
                        className={
                          j.status === 'failed' ? 'border-l-2 border-l-destructive' : undefined
                        }
                      >
                        <Badge variant={STATUS_META[j.status].variant}>
                          {STATUS_META[j.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/posts/${j.post_id}`}
                          className="line-clamp-1 font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {j.post_title ?? j.post_id}
                        </Link>
                        {j.status === 'failed' && j.error ? (
                          <p className="line-clamp-1 text-xs text-destructive" title={j.error}>
                            {j.error}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {j.model}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {j.trigger === 'auto' ? '自动' : '手动'}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {exec != null ? fmtDuration(exec) : '—'}
                      </TableCell>
                      <TableCell
                        className="text-xs tabular-nums text-muted-foreground"
                        title={
                          j.input_tokens != null
                            ? `输入 ${j.input_tokens} · 输出 ${j.output_tokens ?? 0} · 缓存写 ${j.cache_write_tokens ?? 0} · 缓存读 ${j.cache_read_tokens ?? 0}`
                            : undefined
                        }
                      >
                        {j.cost != null ? fmtCost(j.cost) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {jobTimeLabel(j)}
                        {j.attempts > 1 ? ` · 第 ${j.attempts} 次` : ''}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={data.page}
            pageCount={data.pageCount}
            total={data.total}
            basePath="/queue"
            query={{ status, trigger }}
          />
        </>
      )}

      <JobDetailDialog job={detailJob} now={now} onClose={() => setDetailJob(null)} />
    </>
  );
}

/** 任务队列页（analyze:run）：分类筛选 + 分页 + 单任务详情。 */
export function QueuePage() {
  return (
    <RequirePerm perm="analyze:run">
      <QueueView />
    </RequirePerm>
  );
}
