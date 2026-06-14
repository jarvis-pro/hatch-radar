import type { Metadata } from 'next';
import { Badge } from '@hatch-radar/ui/components/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { DbSetupNotice, EmptyState } from '@/components/empty';
import { FilterBar } from '@/components/filter-bar';
import { Forbidden } from '@/components/forbidden';
import { Pagination } from '@/components/pagination';
import { requirePermission } from '@/lib/auth/guards';
import { listAuditLogs } from '@/lib/admin/queries';
import { tryGetDb } from '@/lib/db';
import { parsePage, timeAgo } from '@/lib/format';

export const metadata: Metadata = { title: '审计日志' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  page?: string;
}

/** 审计日志（audit:view）：账户/权限/密钥/分析/导出/设备等操作的追溯。 */
export default async function AuditPage(props: { searchParams: Promise<SearchParams> }) {
  const { allowed } = await requirePermission('audit:view');
  if (!allowed) return <Forbidden />;
  const db = await tryGetDb();
  if (!db) return <DbSetupNotice />;

  const sp = await props.searchParams;
  const q = sp.q?.trim() || undefined;
  const result = await listAuditLogs({ q, page: parsePage(sp.page) });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">审计日志</h1>

      <FilterBar
        basePath="/admin/audit"
        hasFilter={Boolean(q)}
        searchValue={q}
        searchPlaceholder="搜索操作类型（如 account.create）"
        selects={[]}
      />

      {result.items.length === 0 ? (
        <EmptyState
          title="暂无审计记录"
          hint={q ? '试试放宽搜索。' : '账户、权限、密钥、分析、导出等敏感操作会记录在这里。'}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">时间</TableHead>
              <TableHead>操作者</TableHead>
              <TableHead>动作</TableHead>
              <TableHead>对象</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {timeAgo(r.createdAt)}
                </TableCell>
                <TableCell className="text-sm">{r.actorEmail ?? '系统'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">
                    {r.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.targetType ? `${r.targetType}:${r.targetId ?? ''}` : '—'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.ip ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/admin/audit"
        query={{ q }}
      />
    </div>
  );
}
