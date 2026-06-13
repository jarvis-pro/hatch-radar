'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';
import { AnalyzeRow } from '@/components/analyze-row';

/** 工作台单条帖子 */
export interface WorkbenchItem {
  id: string;
  title: string;
  channel: string;
  kind: 'pending' | 'restale';
}

/** 可选模型（启用的模型配置投影） */
export interface ProviderOption {
  id: number;
  label: string;
}

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

interface JobStats {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  canceled: number;
}

interface RecentJob {
  id: number;
  post_title: string | null;
  model: string;
  trigger: 'auto' | 'manual';
  status: JobStatus;
  error: string | null;
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

interface Flash {
  kind: 'ok' | 'err';
  text: string;
}

async function postRun(
  postIds: string[],
  providerId: number,
): Promise<{ ok: boolean; status: number; data: { enqueued?: number; error?: string } | null }> {
  const resp = await fetch('/api/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postIds, providerId }),
  });
  const data = (await resp.json().catch(() => null)) as {
    enqueued?: number;
    error?: string;
  } | null;
  return { ok: resp.ok, status: resp.status, data };
}

/**
 * 分析工作台（客户端）：多选帖子 + 选模型 → 运行（入队），并实时轮询队列进度。
 * 取代旧的「复制文档 / 粘贴结果」人工回路——模型直接串联执行。
 */
export function AnalyzeWorkbench({
  items,
  providers,
  defaultProviderId,
  providersError,
}: {
  items: WorkbenchItem[];
  providers: ProviderOption[];
  defaultProviderId: number | null;
  providersError: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [providerId, setProviderId] = useState<string>(
    defaultProviderId != null && providers.some((p) => p.id === defaultProviderId)
      ? String(defaultProviderId)
      : providers.length > 0
        ? String(providers[0].id)
        : '',
  );
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [jobs, setJobs] = useState<RecentJob[]>([]);

  // 轮询队列看板（3s）
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const resp = await fetch('/api/analysis/jobs');
        if (!resp.ok) return;
        const data = (await resp.json()) as { stats: JobStats; jobs: RecentJob[] };
        if (alive) {
          setStats(data.stats);
          setJobs(data.jobs);
        }
      } catch {
        /* 忽略瞬时拉取失败 */
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
    );
  }

  async function runSelected() {
    const ids = [...selected];
    if (ids.length === 0 || !providerId) return;
    setBusy(true);
    setFlash(null);
    const res = await postRun(ids, Number(providerId));
    setBusy(false);
    if (res.ok) {
      setFlash({ kind: 'ok', text: `已入队 ${res.data?.enqueued ?? ids.length} 篇，模型处理中…` });
      setSelected(new Set());
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? `运行失败（${res.status}）` });
    }
  }

  const noModels = providers.length === 0;

  return (
    <div className="space-y-4">
      {noModels ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {providersError ?? '未配置可用模型。'}请到{' '}
          <Link href="/settings" className="underline">
            设置页
          </Link>{' '}
          添加并启用一个模型后再运行。
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={providerId} onValueChange={setProviderId}>
            <SelectTrigger className="w-auto min-w-44" aria-label="选择模型">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={runSelected} disabled={busy || selected.size === 0 || !providerId}>
            {busy ? '运行中…' : `运行选中（${selected.size}）`}
          </Button>
          {items.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {selected.size === items.length ? '清空' : '全选本页'}
            </Button>
          ) : null}
          {flash ? (
            <span
              className={`text-xs ${flash.kind === 'ok' ? 'text-muted-foreground' : 'text-destructive'}`}
            >
              {flash.text}
            </span>
          ) : null}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          暂无待分析帖子。server 抓取并补全评论后，这里会列出待分析与建议重判的帖子。
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <AnalyzeRow
              key={it.id}
              title={it.title}
              channel={it.channel}
              kind={it.kind}
              selected={selected.has(it.id)}
              onToggle={() => toggle(it.id)}
            />
          ))}
        </div>
      )}

      <QueuePanel stats={stats} jobs={jobs} />
    </div>
  );
}

/** 队列看板：状态汇总 + 最近任务（每 3s 刷新） */
function QueuePanel({ stats, jobs }: { stats: JobStats | null; jobs: RecentJob[] }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">队列</span>
        {stats ? (
          <span className="flex flex-wrap gap-1.5 text-xs">
            <Badge variant="outline">排队 {stats.queued}</Badge>
            <Badge>运行中 {stats.running}</Badge>
            <Badge variant="secondary">成功 {stats.succeeded}</Badge>
            {stats.failed > 0 ? <Badge variant="destructive">失败 {stats.failed}</Badge> : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">加载中…</span>
        )}
      </div>
      {jobs.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无任务记录。</p>
      ) : (
        <ul className="space-y-1">
          {jobs.slice(0, 8).map((j) => (
            <li key={j.id} className="flex items-center gap-2 text-xs">
              <Badge variant={STATUS_META[j.status].variant}>{STATUS_META[j.status].label}</Badge>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {j.post_title ?? j.id}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">{j.model}</span>
              {j.status === 'failed' && j.error ? (
                <span className="shrink-0 max-w-40 truncate text-destructive" title={j.error}>
                  {j.error}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
