import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { hashPassword } from '@hatch-radar/auth';
import { APP_ENV } from '@/common/tokens';
import type { AppEnv } from '@/config/env';
import { RuntimeSettingsService } from '@/config/runtime-settings.service';
import { UsersRepository } from '@/db/users.repository';
import { logger } from '@/logger';
import { nowSec } from '@/utils/time';

/**
 * 首个超级管理员种子（幂等，启动时执行）。
 *
 * 仅当 users 表为空且设置了 SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD 时，创建一个 super_admin
 * 并置 must_change_password=true（首登强制改密）。已有任何账户则跳过——绝不覆盖。
 * 取代原 apps/web/scripts/seed-admin.ts（后端归一：账户权威收进 server）。
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly users: UsersRepository,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // 运行期参数（分析批次 / 会话时长 / worker 调优）默认值入库——与超管种子无关，无条件确保
    await this.runtimeSettings.ensureSeeded();

    const sa = this.env.superAdmin;
    if (!sa) return;
    const count = await this.users.count();
    if (count > 0) return;
    await this.users.create(
      {
        email: sa.email,
        name: '超级管理员',
        passwordHash: await hashPassword(sa.password),
        role: 'super_admin',
        mustChangePassword: true,
        createdBy: null,
        permissions: [],
        grantedBy: null,
      },
      nowSec(),
    );
    logger.info(`[seed] 已创建首个超级管理员：${sa.email}（首次登录将强制改密）`);
  }
}
