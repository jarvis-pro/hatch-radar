import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '@/modules/account/auth-user.decorator';
import { parsePage, trimmed } from '@/common/query-parse';
import { AuditLogsRepository } from '@/database';

/** GET /api/admin/audit —— 审计日志分页（需 audit:view，与账户管理是独立能力）。 */
@RequirePermission('audit:view')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditLogsRepository) {}

  @Get()
  list(@Query() q: Record<string, string | undefined>) {
    return this.audit.listPaged({ q: trimmed(q.q), page: parsePage(q.page) });
  }
}
