/**
 * 收成 · 洞察（/radar/insights）—— 洞察浏览器 / 研判台。
 *
 * 这页的独占职责是**翻查产出、淘出有价值的痛点**（聚合计数归指挥室，不在这里重复仪表盘）。
 * 故它是个可查询的数据台，不是流、也不是第二块仪表盘：
 *   筛选（强度 / 来源 / 版块 / 进程）+ 搜索（痛点 / 标题 / 标签）+ 排序 + **真分页**。
 *
 * 抗规模：筛选 / 排序在 selector 内对 world.insights 现算，**永不静默截断**——
 * 翻页只渲染当页（PAGE_SIZE 行），DOM 恒有界，1 条还是 10 万条同样跑得动。
 * 复用 app house 件 FilterBar / Pagination（URL search params 驱动，可分享、可回退）。
 * 每条可溯源回它的源帖一生（点行 → /radar/posts/:id）。
 */
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@hatch-radar/ui/components/badge';
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
import { EmptyState } from '@/components/empty';
import { FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { ClockBar } from './clock-bar';
import { INTENSITY_META, SOURCE_META } from './constants';
import { useLang, useWorld } from './store';
import type { Insight, Intensity, SourceKind, World } from './types';
import { relPast, tText } from './util';

/** 每页行数。翻页只渲染当页 → DOM 有界，与总量无关。 */
const PAGE_SIZE = 25;
const INTENSITIES: Intensity[] = ['high', 'medium', 'low'];
const SOURCES: SourceKind[] = ['reddit', 'hackernews', 'rss'];
const INTENSITY_RANK: Record<Intensity, number> = { high: 3, medium: 2, low: 1 };

interface HarvestFilters {
  source: string;
  channel: string;
  intensity: string;
  process: string;
  sort: string;
  q: string;
  page: number;
}

function selectHarvest(w: World, f: HarvestFilters) {
  const procLabel = (pid: string): string => w.processes.find((p) => p.id === pid)?.label ?? pid;
  const all = w.insights;

  // facet 选项（按当前产出频次排序；进程 / 版块带计数，「谁在产出价值」并入筛选）
  const procCount = new Map<string, number>();
  const chanCount = new Map<string, number>();
  for (const i of all) {
    procCount.set(i.processId, (procCount.get(i.processId) ?? 0) + 1);
    chanCount.set(i.channel, (chanCount.get(i.channel) ?? 0) + 1);
  }
  const byCountDesc = (a: [string, number], b: [string, number]): number => b[1] - a[1];
  const procOptions = [...procCount.entries()]
    .sort(byCountDesc)
    .map(([pid, c]) => ({ value: pid, label: `${procLabel(pid)} · ${c}` }));
  const channelOptions = [...chanCount.entries()]
    .sort(byCountDesc)
    .map(([ch, c]) => ({ value: ch, label: `${ch} · ${c}` }));
  const present = new Set(all.map((i) => i.source));
  const sourceOptions = SOURCES.filter((s) => present.has(s)).map((s) => ({
    value: s,
    label: SOURCE_META[s].label,
  }));

  // 筛选
  const ql = f.q.toLowerCase();
  const rows = all.filter(
    (i) =>
      (!f.source || i.source === f.source) &&
      (!f.channel || i.channel === f.channel) &&
      (!f.intensity || i.intensity === f.intensity) &&
      (!f.process || i.processId === f.process) &&
      (!ql ||
        i.painPoint.toLowerCase().includes(ql) ||
        i.postTitle.toLowerCase().includes(ql) ||
        i.tags.some((t) => t.toLowerCase().includes(ql))),
  );

  // 统计 = 当前查询的强度切片（不是仪表盘 vanity 计数）
  const split: Record<Intensity, number> = { high: 0, medium: 0, low: 0 };
  for (const i of rows) split[i.intensity] += 1;

  // 排序
  rows.sort((a, b) => {
    if (f.sort === 'intensity')
      return INTENSITY_RANK[b.intensity] - INTENSITY_RANK[a.intensity] || b.createdAt - a.createdAt;
    if (f.sort === 'pain') return b.painCount - a.painCount || b.createdAt - a.createdAt;
    if (f.sort === 'opp') return b.oppCount - a.oppCount || b.createdAt - a.createdAt;
    return b.createdAt - a.createdAt; // 默认：最新优先
  });

  // 分页（钳制页码；只切当页）
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page), pageCount);
  const pageRows = rows
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((i) => ({
      ...i,
      procLabel: procLabel(i.processId),
      titleZh: w.posts.find((p) => p.id === i.postId)?.titleZh,
    }));

  return {
    pageRows,
    total,
    grandTotal: all.length,
    page,
    pageCount,
    split,
    sourceOptions,
    channelOptions,
    procOptions,
    nowMs: w.nowMs,
  };
}

function InsightRow({
  insight,
  nowMs,
  preferOriginal,
  onClick,
}: {
  insight: Insight & { procLabel: string; titleZh?: string };
  nowMs: number;
  preferOriginal: boolean;
  onClick: () => void;
}) {
  const im = INTENSITY_META[insight.intensity];
  const SrcIcon = SOURCE_META[insight.source].icon;
  return (
    <TableRow className="cursor-pointer" onClick={onClick}>
      <TableCell>
        <Badge variant="outline" className={cn('gap-1 px-1.5', im.text)}>
          <span aria-hidden className={cn('size-1.5 rounded-full', im.bar)} />
          {im.label}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="truncate font-medium">{insight.painPoint}</div>
        <div className="truncate text-xs text-muted-foreground">
          {tText(insight.postTitle, insight.titleZh, preferOriginal)}
        </div>
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
        <span className="inline-flex items-center gap-1 truncate">
          <SrcIcon className="size-3.5 shrink-0" />
          {insight.channel}
        </span>
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
        <div className="truncate">{insight.procLabel}</div>
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
        <span className="font-medium text-foreground">{insight.painCount}</span>
        <span className="px-0.5">/</span>
        <span className="font-medium text-foreground">{insight.oppCount}</span>
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums whitespace-nowrap text-muted-foreground">
        {relPast(insight.createdAt, nowMs)}
      </TableCell>
    </TableRow>
  );
}

function Harvest() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const preferOriginal = useLang();
  const source = sp.get('source') ?? '';
  const channel = sp.get('channel') ?? '';
  const intensity = INTENSITIES.includes(sp.get('intensity') as Intensity)
    ? (sp.get('intensity') as string)
    : '';
  const process = sp.get('process') ?? '';
  const sortParam = sp.get('sort') ?? '';
  const sort = ['intensity', 'pain', 'opp'].includes(sortParam) ? sortParam : '';
  const q = sp.get('q')?.trim() ?? '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const hasFilter = Boolean(source || channel || intensity || process || sort || q);

  const d = useWorld((w) => selectHarvest(w, { source, channel, intensity, process, sort, q, page }));

  return (
    <>
      <PageHeader
        title="收成 · 洞察"
        description="翻查这台雷达挖出的洞察——筛选 / 搜索 / 排序，每条可溯源回它的源帖一生。"
        actions={<ClockBar />}
      />

      <FilterBar
        basePath="/radar/insights"
        hasFilter={hasFilter}
        searchValue={q}
        searchPlaceholder="搜索痛点 / 标题 / 标签"
        selects={[
          {
            name: 'intensity',
            placeholder: '全部强度',
            value: intensity,
            options: INTENSITIES.map((k) => ({ value: k, label: `${INTENSITY_META[k].label}信号` })),
          },
          { name: 'source', placeholder: '全部来源', value: source, options: d.sourceOptions },
          { name: 'channel', placeholder: '全部版块', value: channel, options: d.channelOptions },
          { name: 'process', placeholder: '全部进程', value: process, options: d.procOptions },
          {
            name: 'sort',
            placeholder: '默认排序',
            value: sort,
            options: [
              { value: 'intensity', label: '强度高→低' },
              { value: 'pain', label: '痛点最多' },
              { value: 'opp', label: '机会最多' },
            ],
          },
        ]}
      />

      {d.grandTotal === 0 ? (
        <EmptyState title="还没有洞察" hint="等采集 / 分析跑起来，产出会陆续出现在这里。" />
      ) : d.total === 0 ? (
        <EmptyState title="没有符合条件的洞察" hint="试试放宽筛选条件。" />
      ) : (
        <>
          {/* 统计 = 当前查询的强度切片（随筛选实时变，非仪表盘计数） */}
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              共 <span className="font-medium tabular-nums text-foreground">{d.total}</span> 条
              {d.total !== d.grandTotal ? (
                <>
                  {' '}
                  · 全部 <span className="tabular-nums">{d.grandTotal}</span>
                </>
              ) : null}
            </span>
            <span className="inline-flex items-center gap-3">
              {INTENSITIES.map((k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span aria-hidden className={cn('size-1.5 rounded-full', INTENSITY_META[k].bar)} />
                  {INTENSITY_META[k].label}
                  <span className="tabular-nums text-foreground">{d.split[k]}</span>
                </span>
              ))}
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[4.5rem]">强度</TableHead>
                  <TableHead>痛点 · 帖</TableHead>
                  <TableHead className="hidden w-40 md:table-cell">来源 · 版块</TableHead>
                  <TableHead className="hidden w-32 lg:table-cell">产自进程</TableHead>
                  <TableHead className="hidden w-48 xl:table-cell">标签</TableHead>
                  <TableHead className="w-16 text-right">痛/机</TableHead>
                  <TableHead className="w-20 text-right">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.pageRows.map((i) => (
                  <InsightRow
                    key={i.id}
                    insight={i}
                    nowMs={d.nowMs}
                    preferOriginal={preferOriginal}
                    onClick={() => navigate(`/radar/posts/${i.postId}`)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={d.page}
            pageCount={d.pageCount}
            total={d.total}
            basePath="/radar/insights"
            query={{ source, channel, intensity, process, sort, q }}
          />
        </>
      )}
    </>
  );
}

export function HarvestPage() {
  return (
    <RequirePerm perm="analyze:run">
      <Harvest />
    </RequirePerm>
  );
}
