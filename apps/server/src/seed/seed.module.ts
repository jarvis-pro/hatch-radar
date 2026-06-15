import { Module } from '@nestjs/common';
import { RuntimeSettingsModule } from '@/config/runtime-settings.module';
import { RepositoriesModule } from '@/db/repositories.module';
import { SeedService } from './seed.service';

/** 种子模块：启动时幂等播种首个超级管理员与运行期参数默认值（见 SeedService）。 */
@Module({
  imports: [RepositoriesModule, RuntimeSettingsModule],
  providers: [SeedService],
})
export class SeedModule {}
