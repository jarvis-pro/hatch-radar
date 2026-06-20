/**
 * 帖子库（/radar/posts）—— 浏览 / 检索 mock 世界的语料。
 *
 * 单一职责＝**找到一条帖**：搜索（标题/id，中英皆可）+ 来源 / 状态筛选 + 分页（只渲当页一屏，抗规模）。
 * 译文优先显示标题。点行 → /radar/posts/:id 完整详情（内容 + 一生）。
 * 退避分布在「指挥室·复查健康」、单帖完整内容在详情页——这里不堆图表也不堆详情。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowBigUp, ChevronLeft, ChevronRight, MessageSquare, Search, X } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { ClockBar } from './clock-bar';
import { SOURCE_META } from './constants';
import { useLang, useWorld } from './store';
import type { SourceKind, World } from './types';
import { tText } from './util';

const PAGE_SIZE = 12;
const CAP = 16;

type StatusFilter = 'all' | 'due' | 'active' | 'quiet';
type SourceFilter = 'all' | SourceKind;

function recheckSweepOf(w: World): number {
  return w.processes.reduce((mx, p) => {
    const b = w.blueprints.find((x) => x.id === p.blueprintId);
    return b?.kind === 'recheck' ? Math.max(mx, p.sweepSeq) : mx;
  }, 0);
}
function intervalLabel(misses: number): string {
  return misses <= 0 ? '每轮查' : `隔 ${Math.min(2 ** (misses - 1), CAP)} 轮`;
}

function select(w: World, f: { q: string; source: SourceFilter; status: StatusFilter; page: number }) {
  const sweep = recheckSweepOf(w);
  const ql = f.q.trim().toLowerCase();
  const filtered = w.posts
    .map((p) => ({ post: p, misses: p.recheckMisses ?? 0, dueNow: (p.recheckDueSweep ?? 0) <= sweep }))
    .filter((r) => f.source === 'all' || r.post.source === f.source)
    .filter((r) =>
      f.status === 'all'
        ? true
        : f.status === 'due'
          ? r.dueNow
          : f.status === 'active'
            ? r.misses === 0
            : r.misses >= 1,
    )
    .filter(
      (r) =>
        !ql ||
        r.post.title.toLowerCase().includes(ql) ||
        (r.post.titleZh ?? '').toLowerCase().includes(ql) ||
        r.post.id.toLowerCase().includes(ql),
    )
    .sort((a, b) => a.misses - b.misses || b.post.score - a.post.score);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page), pageCount);
  return {
    total: w.posts.length,
    filteredCount: filtered.length,
    pageRows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page,
    pageCount,
  };
}

const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'hackernews', label: 'HN' },
  { key: 'rss', label: 'RSS' },
];
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'due', label: '到期' },
  { key: 'active', label: '活跃' },
  { key: 'quiet', label: '沉默' },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50',
      )}
    >
      {children}
    </button>
  );
}

function LibraryView() {
  const navigate = useNavigate();
  const preferOriginal = useLang();
  const [q, setQ] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const d = useWorld((w) => select(w, { q, source, status, page }));
  const filterActive = q.trim() !== '' || source !== 'all' || status !== 'all';
  const reset = (fn: () => void): void => {
    fn();
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="帖子库"
        description="浏览 / 检索语料——找到一条帖，点进去看完整内容与它的一生（译文优先显示）。"
        actions={<ClockBar />}
      />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => reset(() => setQ(e.target.value))}
              placeholder="搜索标题 / id（中英皆可）"
              className="h-9 pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_FILTERS.map((s) => (
              <Chip key={s.key} active={source === s.key} onClick={() => reset(() => setSource(s.key))}>
                {s.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <Chip key={s.key} active={status === s.key} onClick={() => reset(() => setStatus(s.key))}>
                {s.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            共 {d.filteredCount} 帖{filterActive && d.filteredCount !== d.total ? ` / ${d.total}` : ''}
          </span>
          {filterActive ? (
            <button
              type="button"
              onClick={() =>
                reset(() => {
                  setQ('');
                  setSource('all');
                  setStatus('all');
                })
              }
              className="inline-flex items-center gap-0.5 hover:text-foreground"
            >
              <X className="size-3" /> 清除
            </button>
          ) : null}
        </div>

        {d.total === 0 ? (
          <EmptyState title="还没有帖子" hint="等采集跑起来，入库的帖会出现在这里。" />
        ) : d.pageRows.length === 0 ? (
          <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground/70">没有匹配的帖子。</p>
        ) : (
          <div className="space-y-1.5">
            {d.pageRows.map(({ post, misses, dueNow }) => {
              const SrcIcon = SOURCE_META[post.source].icon;
              return (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => navigate(`/radar/posts/${post.id}`)}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <SrcIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm font-medium">
                      {tText(post.title, post.titleZh, preferOriginal)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span>{post.channel}</span>
                      <span>·</span>
                      <span className={cn(misses === 0 && 'text-signal')}>
                        {misses === 0 ? '活跃' : `连未变 ${misses}`}
                      </span>
                      <span>·</span>
                      <span>{intervalLabel(misses)}</span>
                      {dueNow ? <span className="text-intensity-medium">· 到期</span> : null}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground sm:inline-flex">
                    <span className="inline-flex items-center gap-0.5">
                      <ArrowBigUp className="size-3.5" />
                      {post.score.toLocaleString()}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="size-3" />
                      {post.numComments}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}

        {d.pageCount > 1 ? (
          <div className="flex items-center justify-between pt-1">
            <Button size="sm" variant="outline" disabled={d.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" /> 上一页
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              第 {d.page} / {d.pageCount} 页
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={d.page >= d.pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页 <ChevronRight className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function LibraryPage() {
  return (
    <RequirePerm perm="analyze:run">
      <LibraryView />
    </RequirePerm>
  );
}
