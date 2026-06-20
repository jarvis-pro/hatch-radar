import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';

interface PaginationProps {
  /** 当前页码（从 1 开始） */
  page: number;
  /** 总页数 */
  pageCount: number;
  /** 总条数，用于展示"共 N 条" */
  total: number;
  /** 分页链接的基础路径（不含 query） */
  basePath: string;
  /** 需要随翻页保留的筛选参数（空值自动忽略） */
  query: Record<string, string | undefined>;
  /** 当前每页条数；与 pageSizeOptions 一起传入即启用「每页条数」选择器 */
  pageSize?: number;
  /** 每页条数可选项（如 [10, 25, 50]）；传入即渲染选择器，并使分页条在仅 1 页时仍显示 */
  pageSizeOptions?: number[];
  /** 每页条数的查询参数名，默认 'size' */
  sizeName?: string;
}

/**
 * 链接式分页条（shadcn DataTable 风格）：左「共 N 条」，右为「每页 N 条」+「第 X / Y 页」+ 首/上/下/末。
 * 仅替换 page（保留筛选参数，React Router 客户端导航）；传 pageSize + pageSizeOptions 即启用每页条数选择。
 */
export function Pagination({
  page,
  pageCount,
  total,
  basePath,
  query,
  pageSize,
  pageSizeOptions,
  sizeName = 'size',
}: PaginationProps) {
  const navigate = useNavigate();
  const showSize = !!(pageSizeOptions && pageSizeOptions.length > 0 && pageSize);
  if (pageCount <= 1 && !showSize) return null;

  /** 以当前筛选参数为基础叠加 overrides 构造 URL（空值删除该参数）。 */
  const build = (overrides: Record<string, string | undefined>): string => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
    if (showSize && pageSize) qs.set(sizeName, String(pageSize));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) qs.set(k, v);
      else qs.delete(k);
    }
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const pageHref = (p: number): string => build({ page: p > 1 ? String(p) : undefined });

  const navBtn = (target: number, label: string, icon: ReactNode, enabled: boolean): ReactNode =>
    enabled ? (
      <Button asChild variant="outline" size="icon-sm">
        <Link to={pageHref(target)} aria-label={label}>
          {icon}
        </Link>
      </Button>
    ) : (
      <Button variant="outline" size="icon-sm" disabled aria-label={label}>
        {icon}
      </Button>
    );

  const prev = page > 1;
  const next = page < pageCount;

  return (
    <nav
      className="mt-6 flex flex-col items-center justify-between gap-3 text-sm sm:flex-row"
      aria-label="分页"
    >
      <span className="text-muted-foreground tabular-nums">共 {total} 条</span>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
        {showSize ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            每页
            <Select
              value={String(pageSize)}
              onValueChange={(v) => navigate(build({ page: undefined, [sizeName]: v }))}
            >
              <SelectTrigger className="h-8 w-auto" aria-label="每页条数">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions!.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            条
          </span>
        ) : null}

        <span className="text-muted-foreground tabular-nums">
          第 {page} / {pageCount} 页
        </span>

        <div className="flex items-center gap-1">
          {navBtn(1, '首页', <ChevronsLeft />, prev)}
          {navBtn(page - 1, '上一页', <ChevronLeft />, prev)}
          {navBtn(page + 1, '下一页', <ChevronRight />, next)}
          {navBtn(pageCount, '末页', <ChevronsRight />, next)}
        </div>
      </div>
    </nav>
  );
}
