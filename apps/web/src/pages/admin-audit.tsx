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
import { cn } from '@hatch-radar/ui/lib/utils';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { parsePage, timeAgo } from '@/lib/format';
import { buildQuery } from '@/lib/qs';

/** 失败 / 删除 / 吊销 / 停用 / 取消等负向、敏感事件——审计里最该一眼揪出的。 */
const ACTION_NEGATIVE = /\.(failed|locked|delete|revoke|disable|cancel)$/;

/** 审计动作 → 语义色分类（负向红 / 登录青 / 账户靛 / 其它中性）。 */
function actionClass(action: string): string {
  if (ACTION_NEGATIVE.test(action)) {
    return 'border-destructive/30 bg-destructive/10 text-destructive';
  }

  if (action.startsWith('auth.')) {
    return 'border-signal/30 bg-signal/12 text-signal';
  }

  if (action.startsWith('account.')) {
    return 'border-primary/30 bg-primary/12 text-primary';
  }

  return 'text-muted-foreground';
}

/** 审计动作徽标：等宽 + 按类别语义着色。 */
function ActionBadge({ action }: { action: string }) {
  return (
    <Badge variant="outline" className={cn('font-mono text-xs font-normal', actionClass(action))}>
      {action}
    </Badge>
  );
}

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
        description="账户 / 权限 / 密钥 / 分析 / 导出等敏感操作的追溯"
      />

      <FilterBar
        basePath="/admin/audit"
        hasFilter={Boolean(q)}
        searchValue={q}
        searchPlaceholder="搜索操作类型（如 account.create）"
        selects={[]}
      />

      {auditQ.isError ? (
        <LoadError
          message={auditQ.error instanceof ApiError ? auditQ.error.message : undefined}
          onRetry={() => void auditQ.refetch()}
        />
      ) : auditQ.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : auditQ.data.items.length === 0 ? (
        <EmptyState
          title="暂无审计记录"
          hint={q ? '试试放宽搜索。' : '账户、权限、密钥、分析、导出等敏感操作会记录在这里。'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
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
                      <ActionBadge action={r.action} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.targetType ? `${r.targetType}:${r.targetId ?? ''}` : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.ip ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
