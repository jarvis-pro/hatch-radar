/**
 * 帖子库（/radar/posts）—— 浏览 / 检索 mock 世界的语料。
 *
 * 传统表格展示（单条信息量小，一行足以）：ID / 标题（译文优先，已译帖在标题后标注翻译图标）/ 版块 / 复查状态 / 节奏 / 热度。
 * 专属搜索栏走**延迟提交**：改下拉或输入并不立即查，点「搜索」才把条件写进 URL 生效，「重置」一键清空；
 * 区别于其余页共用的即时 FilterBar（故此页内联自己的栏，不复用）。URL search params 驱动可分享可回退，
 * 配统一 Pagination 翻页只渲当页抗规模。点行 → 详情。
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowBigUp, Languages, MessageSquare, Search } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { SOURCE_META } from './constants';
import { useLang, useWorld } from './store';
import type { SourceKind, World } from './types';
import { isTranslated, tText } from './util';

const CAP = 16;
const PAGE_SIZES = [10, 25, 50];
const DEFAULT_SIZE = 25;
const SOURCES: SourceKind[] = ['reddit', 'hackernews', 'rss'];
const STATUS_OPTIONS = [
  { value: 'due', label: '到期' },
  { value: 'active', label: '活跃' },
  { value: 'quiet', label: '沉默' },
];
// Radix Select 不接受空字符串 value，用哨兵代表「全部」（提交时还原为去掉该参数）
const ALL = '__all__';

function recheckSweepOf(w: World): number {
  return w.processes.reduce((mx, p) => {
    const b = w.blueprints.find((x) => x.id === p.blueprintId);
    return b?.kind === 'recheck' ? Math.max(mx, p.sweepSeq) : mx;
  }, 0);
}
function intervalLabel(misses: number): string {
  return misses <= 0 ? '每轮查' : `隔 ${Math.min(2 ** (misses - 1), CAP)} 轮`;
}
/** URL 上的 status 须在白名单内才算数，否则视为「全部」。 */
function validStatus(v: string | null): string {
  return STATUS_OPTIONS.some((s) => s.value === v) ? (v as string) : '';
}

function select(
  w: World,
  f: { source: string; status: string; q: string; page: number; size: number },
) {
  const sweep = recheckSweepOf(w);
  const ql = f.q.toLowerCase();
  const rows = w.posts
    .map((p) => ({
      post: p,
      misses: p.recheckMisses ?? 0,
      dueNow: (p.recheckDueSweep ?? 0) <= sweep,
    }))
    .filter((r) => !f.source || r.post.source === f.source)
    .filter((r) =>
      f.status === 'due'
        ? r.dueNow
        : f.status === 'active'
          ? r.misses === 0
          : f.status === 'quiet'
            ? r.misses >= 1
            : true,
    )
    // 标题 + 正文（中英）模糊搜索
    .filter(
      (r) =>
        !ql ||
        r.post.title.toLowerCase().includes(ql) ||
        (r.post.titleZh ?? '').toLowerCase().includes(ql) ||
        r.post.body.toLowerCase().includes(ql) ||
        (r.post.bodyZh ?? '').toLowerCase().includes(ql),
    )
    .sort((a, b) => a.misses - b.misses || b.post.score - a.post.score);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / f.size));
  const page = Math.min(Math.max(1, f.page), pageCount);
  return {
    total,
    grandTotal: w.posts.length,
    pageRows: rows.slice((page - 1) * f.size, page * f.size),
    page,
    pageCount,
  };
}

function LibraryView() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  // URL 上「已提交」的条件 —— 表格按它渲染、分页随它保留
  const source = sp.get('source') ?? '';
  const status = validStatus(sp.get('status'));
  const q = sp.get('q')?.trim() ?? '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const size = PAGE_SIZES.includes(Number(sp.get('size'))) ? Number(sp.get('size')) : DEFAULT_SIZE;

  // 搜索草稿（延迟提交）：改下拉 / 输入只动本地，点「搜索」才写进 URL；
  // URL 上的条件变化（提交本身 / 外部带参导航）时回灌——翻页只改 page 不动这三者，故草稿不被冲掉
  const [draft, setDraft] = useState({ source, status, q });
  useEffect(() => setDraft({ source, status, q }), [source, status, q]);

  // 标题语言跟随全局「译文 / 原文」偏好（译文优先）；已译帖在标题后标注翻译图标，仅作标识、不可点切换
  const preferOriginal = useLang();

  const d = useWorld((w) => select(w, { source, status, q, page, size }));

  /** 把一组条件写进 URL（回第 1 页；保留非默认的每页条数这一浏览偏好）。 */
  const apply = (next: { source: string; status: string; q: string }): void => {
    const params = new URLSearchParams();
    if (next.source) params.set('source', next.source);
    if (next.status) params.set('status', next.status);
    if (next.q.trim()) params.set('q', next.q.trim());
    if (size !== DEFAULT_SIZE) params.set('size', String(size));
    const qs = params.toString();
    navigate(qs ? `/radar/posts?${qs}` : '/radar/posts');
  };
  const reset = (): void => apply({ source: '', status: '', q: '' });

  return (
    <>
      <PageHeader
        title="帖子库"
        description="浏览雷达采集入库的原始语料——按来源、复查状态与关键词检索，逐条下钻完整内容，追溯其一生（采集 → 复查退避 → 重分析 → 洞察）。译文优先显示。"
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <Select
          value={draft.source || ALL}
          onValueChange={(v) => setDraft((s) => ({ ...s, source: v === ALL ? '' : v }))}
        >
          <SelectTrigger className="w-full sm:w-auto sm:min-w-34" aria-label="全部来源">
            <SelectValue placeholder="全部来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部来源</SelectItem>
            {SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={draft.status || ALL}
          onValueChange={(v) => setDraft((s) => ({ ...s, status: v === ALL ? '' : v }))}
        >
          <SelectTrigger className="w-full sm:w-auto sm:min-w-34" aria-label="全部状态">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部状态</SelectItem>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative min-w-0 flex-1 sm:min-w-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={draft.q}
            onChange={(e) => setDraft((s) => ({ ...s, q: e.target.value }))}
            placeholder="搜索标题 / 正文"
            className="pl-8"
          />
        </div>

        <Button type="submit">搜索</Button>
        <Button type="button" variant="outline" onClick={reset}>
          重置
        </Button>
      </form>

      {d.grandTotal === 0 ? (
        <EmptyState title="还没有帖子" hint="等采集跑起来，入库的帖会出现在这里。" />
      ) : d.total === 0 ? (
        <EmptyState title="没有符合条件的帖子" hint="换个来源 / 状态，或调整搜索词后重试。" />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="hidden w-28 sm:table-cell">ID</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead className="hidden w-36 md:table-cell">版块</TableHead>
                  <TableHead className="w-28">状态</TableHead>
                  <TableHead className="hidden w-24 lg:table-cell">复查节奏</TableHead>
                  <TableHead className="hidden w-28 text-right sm:table-cell">热度</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.pageRows.map(({ post, misses, dueNow }) => {
                  const SrcIcon = SOURCE_META[post.source].icon;
                  return (
                    <TableRow
                      key={post.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/radar/posts/${post.id}`)}
                    >
                      <TableCell className="hidden font-mono text-xs text-muted-foreground/70 sm:table-cell">
                        <span className="block truncate">{post.id}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <SrcIcon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 truncate font-medium">
                            {tText(post.title, post.titleZh, preferOriginal)}
                          </span>
                          {isTranslated(post) ? (
                            <Languages
                              aria-label="已翻译"
                              className="size-3.5 shrink-0 text-muted-foreground/50"
                            />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        <div className="truncate">{post.channel}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className={misses === 0 ? 'text-signal' : 'text-muted-foreground'}>
                          {misses === 0 ? '活跃' : `连未变 ${misses}`}
                        </span>
                        {dueNow ? <span className="ml-1.5 text-intensity-medium">到期</span> : null}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {intervalLabel(misses)}
                      </TableCell>
                      <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                        <span className="inline-flex items-center justify-end gap-3">
                          <span className="inline-flex items-center gap-0.5">
                            <ArrowBigUp className="size-3.5" />
                            {post.score.toLocaleString()}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare className="size-3" />
                            {post.numComments}
                          </span>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={d.page}
            pageCount={d.pageCount}
            total={d.total}
            basePath="/radar/posts"
            query={{ source, status, q }}
            pageSize={size}
            pageSizeOptions={PAGE_SIZES}
          />
        </>
      )}
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
