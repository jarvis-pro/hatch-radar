import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { AuditLogsRepository, parsePage, trimmed } from '@hatch-radar/core';

/** GET /api/admin/audit —— 审计日志分页（需 audit:view，与账户管理是独立能力）。 */
@UseGuards(SessionAuthGuard)
@RequirePermission('audit:view')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditLogsRepository) {}

  @Get()
  list(@Query() q: Record<string, string | undefined>) {
    return this.audit.listPaged({ q: trimmed(q.q), page: parsePage(q.page) });
  }
}
