/**
 * 洞察库（/radar/insights）—— 洞察浏览器 / 研判台（帖子库的产出对应物：原始语料 → 提炼洞察）。
 *
 * 这页的独占职责是**翻查产出、淘出有价值的痛点**（聚合计数归指挥室，不在这里重复仪表盘）。
 * 故它是个可查询的数据台，不是流、也不是第二块仪表盘：
 *   筛选（强度 / 来源）+ 关键词搜索 + 列头点击排序 + **真分页**。
 * 搜索栏走**延迟提交**（仿帖子库：改下拉 / 输入只动草稿，点「搜索」才写进 URL），与其余页即时 FilterBar 区隔。
 * 排序下放到列头：点「痛机 / 时间」即时切排序，再点切方向（默认时间最新优先）。
 *
 * 抗规模：筛选 / 排序 / 分页全在**服务端**（react-query 命中 /api/radar/insights），
 * 翻页只取当页、keepPreviousData 平滑切换；DOM 恒有界，1 条还是 10 万条同样跑得动。
 * 每条可点开看痛点 / 机会全文与人工研判（点行 → /radar/insights/:id），并可下钻其源帖一生。
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react';
import type { RadarInsightDTO, RadarIntensity, RadarSourceKind } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { ExportBatchButton } from '@/components/export-batch';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { timeAgo } from '@/lib/format';
import { INTENSITY_META, SOURCE_META } from './constants';
import { useInsights, useRadarFilterOptions } from './hooks';

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_SIZE = 25;
const INTENSITIES: RadarIntensity[] = ['high', 'medium', 'low'];
const SOURCES: RadarSourceKind[] = ['reddit', 'hackernews', 'rss'];
// Radix Select 不接受空字符串 value，用哨兵代表「全部」（提交时还原为去掉该参数）
const ALL = '__all__';

// 排序：列头点击驱动。key=维度，dir=方向；默认 time-desc（最新优先，URL 省略以保持简洁）
type SortKey = 'pain' | 'time';
type SortDir = 'asc' | 'desc';
const SORT_KEYS: SortKey[] = ['pain', 'time'];
const DEFAULT_SORT = 'time-desc';

/** 解析 URL 上的 sort（`{key}-{dir}`）；非法或缺省回落到默认时间倒序。 */
function parseSort(v: string | null): { key: SortKey; dir: SortDir } {
  const [k, d] = (v ?? '').split('-');
  if (SORT_KEYS.includes(k as SortKey) && (d === 'asc' || d === 'desc')) {
    return { key: k as SortKey, dir: d };
  }

  return { key: 'time', dir: 'desc' };
}

/** 可点击排序的列头：显示当前方向箭头，未激活列以淡色双箭头提示可排序。 */
function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  align,
  className,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  align?: 'right';
  className?: string;
  onSort: (k: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = !active ? ChevronsUpDown : dir === 'desc' ? ArrowDown : ArrowUp;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`按${label}排序`}
        className={cn(
          'group -mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors hover:text-foreground',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
        <Icon
          className={cn('size-3.5 shrink-0', !active && 'opacity-40 group-hover:opacity-100')}
        />
      </button>
    </TableHead>
  );
}

function InsightRow({ insight, onClick }: { insight: RadarInsightDTO; onClick: () => void }) {
  const im = INTENSITY_META[insight.intensity];
  const srcMeta = SOURCE_META[insight.source as RadarSourceKind];
  const SrcIcon = srcMeta?.icon;

  return (
    <TableRow className="cursor-pointer" onClick={onClick}>
      <TableCell className="hidden font-mono text-xs text-muted-foreground/70 xl:table-cell">
        <span className="block truncate">{insight.id}</span>
      </TableCell>
      <TableCell>
        <div className="truncate font-medium">{insight.painPoint}</div>
        <div className="truncate text-xs text-muted-foreground">
          {insight.titleZh ?? insight.postTitle}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn('gap-1 px-1.5', im.text)}>
          <span aria-hidden className={cn('size-1.5 rounded-full', im.bar)} />
          {im.label}
        </Badge>
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
        <span className="inline-flex items-center gap-1 truncate">
          {SrcIcon ? <SrcIcon className="size-3.5 shrink-0" /> : null}
          {insight.channel}
        </span>
      </TableCell>
      <TableCell className="hidden xl:table-cell">
        <div className="flex gap-1 overflow-hidden">
          {insight.tags.slice(0, 3).map((t) => (
            <Badge key={t} variant="secondary" className="font-normal whitespace-nowrap">
              {t}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
        <span className="font-medium text-foreground">{insight.oppCount}</span>
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums whitespace-nowrap text-muted-foreground">
        {timeAgo(insight.createdAt)}
      </TableCell>
    </TableRow>
  );
}

function Harvest() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  // URL 上「已提交」的筛选 —— 表格按它渲染、翻页 / 排序随它保留
  const source = sp.get('source') ?? '';
  const subreddit = sp.get('subreddit') ?? '';
  const intensity = INTENSITIES.includes(sp.get('intensity') as RadarIntensity)
    ? (sp.get('intensity') as string)
    : '';
  const q = sp.get('q')?.trim() ?? '';
  const sort = sp.get('sort') ?? '';
  const { key: sortKey, dir: sortDir } = parseSort(sort);
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const size = PAGE_SIZES.includes(Number(sp.get('size'))) ? Number(sp.get('size')) : DEFAULT_SIZE;

  // 来源 / 版块去重清单（版块下拉 + 导出批次共用；变动慢，缓存）
  const optionsQ = useRadarFilterOptions();
  const subreddits = optionsQ.data?.subreddits ?? [];

  // 搜索草稿（延迟提交，仿帖子库）：改下拉 / 输入只动本地，点「搜索」才写进 URL；
  // URL 上条件变化（提交本身 / 外部带参导航 / 列头排序）时回灌——翻页 / 排序只改其他参数不动这四者
  const [draft, setDraft] = useState({ source, subreddit, intensity, q });
  useEffect(() => setDraft({ source, subreddit, intensity, q }), [source, subreddit, intensity, q]);

  // 服务端筛选 / 排序 / 分页：把已提交条件喂给 /api/radar/insights（排序只取维度，方向由列头交互附带）
  const queryResult = useInsights({
    source: source || undefined,
    subreddit: subreddit || undefined,
    intensity: (intensity || undefined) as RadarIntensity | undefined,
    q: q || undefined,
    sort: sortKey,
    page,
    size,
  });
  const data = queryResult.data;
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;
  const rows = data?.items ?? [];

  /** 把一组条件写进 URL（回第 1 页；保留排序与每页条数这两项浏览偏好）。 */
  const apply = (next: {
    source: string;
    subreddit: string;
    intensity: string;
    q: string;
  }): void => {
    const params = new URLSearchParams();
    if (next.source) {
      params.set('source', next.source);
    }

    if (next.subreddit) {
      params.set('subreddit', next.subreddit);
    }

    if (next.intensity) {
      params.set('intensity', next.intensity);
    }

    if (next.q.trim()) {
      params.set('q', next.q.trim());
    }

    if (sort) {
      params.set('sort', sort);
    }

    if (size !== DEFAULT_SIZE) {
      params.set('size', String(size));
    }

    const qStr = params.toString();
    navigate(qStr ? `/radar/insights?${qStr}` : '/radar/insights');
  };

  const reset = (): void => apply({ source: '', subreddit: '', intensity: '', q: '' });

  /** 列头点击排序（即时，作用于已提交的筛选；回第 1 页，同列切方向、换列以倒序起步）。 */
  const applySort = (key: SortKey): void => {
    const dir: SortDir = sortKey === key && sortDir === 'desc' ? 'asc' : 'desc';
    const nextSort = `${key}-${dir}`;
    const params = new URLSearchParams();
    if (source) {
      params.set('source', source);
    }

    if (subreddit) {
      params.set('subreddit', subreddit);
    }

    if (intensity) {
      params.set('intensity', intensity);
    }

    if (q) {
      params.set('q', q);
    }

    if (nextSort !== DEFAULT_SORT) {
      params.set('sort', nextSort);
    }

    if (size !== DEFAULT_SIZE) {
      params.set('size', String(size));
    }

    const qStr = params.toString();
    navigate(qStr ? `/radar/insights?${qStr}` : '/radar/insights');
  };

  return (
    <>
      <PageHeader
        title="洞察库"
        description="AI 从语料里淘出的用户痛点与产品机会——按强度、来源、版块筛选或关键词搜索，点开看痛点 / 机会全文与人工研判，每条可溯源回源帖一生。"
        actions={<ExportBatchButton subreddits={subreddits} />}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <Select
          value={draft.intensity || ALL}
          onValueChange={(v) => setDraft((s) => ({ ...s, intensity: v === ALL ? '' : v }))}
        >
          <SelectTrigger className="w-full sm:w-auto sm:min-w-34" aria-label="全部强度">
            <SelectValue placeholder="全部强度" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部强度</SelectItem>
            {INTENSITIES.map((k) => (
              <SelectItem key={k} value={k}>
                {INTENSITY_META[k].label}信号
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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

        {subreddits.length > 0 ? (
          <Select
            value={draft.subreddit || ALL}
            onValueChange={(v) => setDraft((s) => ({ ...s, subreddit: v === ALL ? '' : v }))}
          >
            <SelectTrigger className="w-full sm:w-auto sm:min-w-34" aria-label="全部版块">
              <SelectValue placeholder="全部版块" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部版块</SelectItem>
              {subreddits.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="relative min-w-0 flex-1 sm:min-w-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={draft.q}
            onChange={(e) => setDraft((s) => ({ ...s, q: e.target.value }))}
            placeholder="搜索痛点 / 标题 / 标签"
            className="pl-8"
          />
        </div>

        <Button type="submit">搜索</Button>
        <Button type="button" variant="outline" onClick={reset}>
          重置
        </Button>
      </form>

      {queryResult.isError ? (
        <LoadError onRetry={() => void queryResult.refetch()} />
      ) : queryResult.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : total === 0 ? (
        <EmptyState
          title="没有符合条件的洞察"
          hint="换个强度 / 来源，或调整搜索词后重试；若全空，等采集 / 分析跑起来产出会陆续出现。"
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="hidden w-24 xl:table-cell">ID</TableHead>
                  <TableHead>痛点 · 帖</TableHead>
                  <TableHead className="w-[4.5rem]">强度</TableHead>
                  <TableHead className="hidden w-40 lg:table-cell">来源 · 版块</TableHead>
                  <TableHead className="hidden w-48 xl:table-cell">标签</TableHead>
                  <SortHeader
                    label="机会"
                    sortKey="pain"
                    activeKey={sortKey}
                    dir={sortDir}
                    align="right"
                    className="w-20 text-right"
                    onSort={applySort}
                  />
                  <SortHeader
                    label="时间"
                    sortKey="time"
                    activeKey={sortKey}
                    dir={sortDir}
                    align="right"
                    className="w-20 text-right"
                    onSort={applySort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => (
                  <InsightRow
                    key={i.id}
                    insight={i}
                    onClick={() => navigate(`/radar/insights/${i.id}`)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={page}
            pageCount={pageCount}
            total={total}
            basePath="/radar/insights"
            query={{ source, subreddit, intensity, q, sort }}
            pageSize={size}
            pageSizeOptions={PAGE_SIZES}
          />
        </>
      )}
    </>
  );
}

export function HarvestPage() {
  return (
    <RequirePerm perm="insights:view">
      <Harvest />
    </RequirePerm>
  );
}
