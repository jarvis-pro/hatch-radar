import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';

/**
 * 链接式分页条：保留当前筛选参数，仅替换 page。
 * 纯 GET 导航，无客户端 JS。
 */
export function Pagination({
  page,
  pageCount,
  total,
  basePath,
  query,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  /** 需要随翻页保留的筛选参数（空值自动忽略） */
  query: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;
  const href = (p: number): string => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) qs.set(key, value);
    }
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav className="mt-6 flex items-center justify-center gap-3 text-sm" aria-label="分页">
      {page > 1 ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page - 1)}>
            <ChevronLeft />
            上一页
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          <ChevronLeft />
          上一页
        </Button>
      )}
      <span className="text-muted-foreground tabular-nums">
        第 {page} / {pageCount} 页 · 共 {total} 条
      </span>
      {page < pageCount ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page + 1)}>
            下一页
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          下一页
          <ChevronRight />
        </Button>
      )}
    </nav>
  );
}
