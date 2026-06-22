import { Module } from '@nestjs/common';
import { BlueprintsSeeder } from './blueprints.seeder';
import { ProcessesSeeder } from './processes.seeder';
import { RuntimeSettingsSeeder } from './runtime-settings.seeder';
import { SeedRunner } from './seed.runner';
import { SourcesSeeder } from './sources.seeder';
import { SuperAdminSeeder } from './super-admin.seeder';
import { SeedHook } from './seed.hook';

/**
 * 种子上下文：启动时 SeedHook 调 SeedRunner 统一编排全部幂等引导种子
 * （sources / super-admin / runtime-settings / blueprints / processes），须排在 SchedulerModule 之前。
 * 叶子模块：各 Seeder 仅依赖全局仓储 / RuntimeSettings / APP_ENV。
 */
@Module({
  providers: [
    SourcesSeeder,
    SuperAdminSeeder,
    RuntimeSettingsSeeder,
    BlueprintsSeeder,
    ProcessesSeeder,
    SeedRunner,
    SeedHook,
  ],
})
export class SeedModule {}
