import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '@/modules/account/auth-user.decorator';
import { parsePage, trimmed } from '@/common/query-parse';
import { AuditLogsRepository } from '@/database';

/** GET /api/admin/audit —— 审计日志分页（需 audit:view，与账户管理是独立能力）。 */
@RequirePermission('audit:view')
@Controller('admin/audit')
export class AuditController {
  constructor(
    // 审计日志仓储：分页查询审计记录（支持关键字过滤）
    private readonly audit: AuditLogsRepository,
  ) {}

  @Get()
  list(@Query() q: Record<string, string | undefined>) {
    return this.audit.listPaged({ q: trimmed(q.q), page: parsePage(q.page) });
  }
}
