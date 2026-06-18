import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
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
import { timeAgo } from '@/lib/format';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

interface LaneView {
  lane: string;
  ratePerMinute: number;
  paused: boolean;
  running: number;
  recent: number;
}

interface RequestView {
  id: number;
  lane: string;
  purpose: string;
  url: string;
  status: string;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

interface Overview {
  lanes: LaneView[];
  recent: RequestView[];
}

const STATUS_META: Record<string, { label: string; variant: Variant }> = {
  running: { label: '进行中', variant: 'default' },
  done: { label: '完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  pending: { label: '排队', variant: 'outline' },
  canceled: { label: '取消', variant: 'outline' },
};

function statusMeta(s: string): { label: string; variant: Variant } {
  return STATUS_META[s] ?? { label: s, variant: 'outline' };
}

function RequestsView() {
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['requests'],
    queryFn: () => api.get<Overview>('/requests'),
    refetchInterval: 3000,
  });

  async function toggle(lane: string, paused: boolean): Promise<void> {
    setBusy(lane);
    try {
      await api.post(`/requests/lanes/${encodeURIComponent(lane)}/${paused ? 'resume' : 'pause'}`);
      await q.refetch();
    } catch {
      // 静默：轮询会反映最新状态
    } finally {
      setBusy(null);
    }
  }

  const lanes = q.data?.lanes ?? [];
  const recent = q.data?.recent ?? [];

  return (
    <>
      <PageHeader
        title="请求闸"
        description="所有外站抓取请求的执行计划 · 每 3 秒刷新 · 可按 lane 暂停 / 恢复（暂停时 worker 抓取阻塞至恢复）"
      />

      {q.isError ? (
        <LoadError
          message={q.error instanceof ApiError ? q.error.message : undefined}
          onRetry={() => void q.refetch()}
        />
      ) : q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          {lanes.length === 0 ? (
            <EmptyState
              title="暂无 lane"
              hint="触发一次采集后，reddit / hackernews / rss 等 lane 会在此出现。"
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {lanes.map((l) => (
                <div key={l.lane} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium">{l.lane}</span>
                    {l.paused ? <Badge variant="outline">已暂停</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    限速 {l.ratePerMinute}/min · 在途 {l.running} · 近一小时 {l.recent}
                  </div>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant={l.paused ? 'default' : 'outline'}
                    disabled={busy === l.lane}
                    onClick={() => void toggle(l.lane, l.paused)}
                  >
                    {l.paused ? '恢复' : '暂停'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">lane</TableHead>
                  <TableHead className="w-20">用途</TableHead>
                  <TableHead>请求</TableHead>
                  <TableHead className="w-20">状态</TableHead>
                  <TableHead className="w-28">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      暂无请求记录
                    </TableCell>
                  </TableRow>
                ) : (
                  recent.map((r) => {
                    const meta = statusMeta(r.status);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.lane}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.purpose}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <span className="line-clamp-1" title={r.error ?? r.url}>
                            {r.url || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {timeAgo(r.finishedAt ?? r.startedAt ?? 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </>
  );
}

/** 请求闸控制台页（analyze:run）：lane 概览 + 暂停 / 恢复 + 最近请求。 */
export function RequestsPage() {
  return (
    <RequirePerm perm="analyze:run">
      <RequestsView />
    </RequirePerm>
  );
}
