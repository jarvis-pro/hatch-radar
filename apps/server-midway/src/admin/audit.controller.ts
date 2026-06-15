import { Controller, Get, Inject, Query, UseGuard } from '@midwayjs/core';
import { parsePage, trimmed, type AuditLogsRepository } from '@hatch-radar/core';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { TOK } from '@/common/tokens';

/** GET /api/admin/audit —— 审计日志分页（需 audit:view，与账户管理是独立能力）。 */
@UseGuard(SessionAuthGuard)
@RequirePermission('audit:view')
@Controller('/admin/audit')
export class AuditController {
  @Inject(TOK.auditLogs)
  audit!: AuditLogsRepository;

  @Get('/')
  list(@Query() q: Record<string, string | undefined>) {
    return this.audit.listPaged({ q: trimmed(q.q), page: parsePage(q.page) });
  }
}
