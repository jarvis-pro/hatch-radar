import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AuditRow, Paged } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
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
import { FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { parsePage, timeAgo } from '@/lib/format';
import { buildQuery } from '@/lib/qs';

function AuditView() {
  const [sp] = useSearchParams();
  const q = sp.get('q')?.trim() || undefined;
  const page = parsePage(sp.get('page'));

  const auditQ = useQuery({
    queryKey: ['admin', 'audit', q, page],
    queryFn: () =>
      api.get<Paged<AuditRow>>(
        `/admin/audit${buildQuery({ q, page: page > 1 ? page : undefined })}`,
      ),
  });

  return (
    <div>
      <PageHeader
        title="审计日志"
        description="账户 / 权限 / 密钥 / 分析 / 导出 / 设备等敏感操作的追溯"
      />

      <FilterBar
        basePath="/admin/audit"
        hasFilter={Boolean(q)}
        searchValue={q}
        searchPlaceholder="搜索操作类型（如 account.create）"
        selects={[]}
      />

      {auditQ.isError ? (
        <LoadError message={auditQ.error instanceof ApiError ? auditQ.error.message : undefined} />
      ) : auditQ.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : auditQ.data.items.length === 0 ? (
        <EmptyState
          title="暂无审计记录"
          hint={q ? '试试放宽搜索。' : '账户、权限、密钥、分析、导出等敏感操作会记录在这里。'}
        />
      ) : (
        <>
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
              {auditQ.data.items.map((r) => (
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
          <Pagination
            page={auditQ.data.page}
            pageCount={auditQ.data.pageCount}
            total={auditQ.data.total}
            basePath="/admin/audit"
            query={{ q }}
          />
        </>
      )}
    </div>
  );
}

/** 审计日志（audit:view）：账户/权限/密钥/分析/导出/设备等操作的追溯。 */
export function AuditPage() {
  return (
    <RequirePerm perm="audit:view">
      <AuditView />
    </RequirePerm>
  );
}
