import { Module } from '@nestjs/common';
import { SeedHook } from './seed.hook';

/**
 * 种子模块：启动时由 SeedHook 调 core 的 SeedRunner 统一编排全部幂等引导种子。
 * 编排器与各 Seeder（sources / super-admin / runtime-settings）都在 @hatch-radar/core。
 */
@Module({
  providers: [SeedHook],
})
export class SeedModule {}
