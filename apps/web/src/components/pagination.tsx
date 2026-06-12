import Link from 'next/link';

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
    <nav className="pagination" aria-label="分页">
      {page > 1 ? (
        <Link href={href(page - 1)}>← 上一页</Link>
      ) : (
        <span className="page-disabled">← 上一页</span>
      )}
      <span className="page-info">
        第 {page} / {pageCount} 页 · 共 {total} 条
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)}>下一页 →</Link>
      ) : (
        <span className="page-disabled">下一页 →</span>
      )}
    </nav>
  );
}
