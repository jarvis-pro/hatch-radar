import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/db/repositories.module';
import { SeedService } from './seed.service';

/** 种子模块：启动时幂等创建首个超级管理员（见 SeedService）。 */
@Module({
  imports: [RepositoriesModule],
  providers: [SeedService],
})
export class SeedModule {}
