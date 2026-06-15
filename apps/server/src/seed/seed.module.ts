import { Module } from '@nestjs/common';
import { RuntimeSettingsModule } from '@/config/runtime-settings.module';
import { RepositoriesModule } from '@/db/repositories.module';
import { RuntimeSettingsSeeder } from './runtime-settings.seeder';
import { SeedRunner } from './seed.runner';
import { SEEDERS, type Seeder } from './seeder';
import { SourcesSeeder } from './sources.seeder';
import { SuperAdminSeeder } from './super-admin.seeder';

/**
 * 种子模块：启动时由 SeedRunner 统一编排全部幂等引导种子（单一入口）。
 * 新增一类种子：① 写一个实现 Seeder 的类 ② 加进下方 providers 与 SEEDERS 的 inject 列表。
 * imports：RepositoriesModule 提供 Users/Sources 仓储、RuntimeSettingsModule 提供运行期设置服务
 * （APP_ENV 由全局 AppConfigModule 提供）。
 */
@Module({
  imports: [RepositoriesModule, RuntimeSettingsModule],
  providers: [
    SourcesSeeder,
    SuperAdminSeeder,
    RuntimeSettingsSeeder,
    {
      // NestJS 不支持 Angular 式 `multi: true`，故用 useFactory 把各 Seeder 聚合成数组
      provide: SEEDERS,
      useFactory: (...seeders: Seeder[]) => seeders,
      inject: [SourcesSeeder, SuperAdminSeeder, RuntimeSettingsSeeder], // ← 新增 Seeder 在此登记
    },
    SeedRunner,
  ],
})
export class SeedModule {}
