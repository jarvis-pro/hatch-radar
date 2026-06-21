/**
 * apps/api 领域桶（domain）：把能力包（kernel / db / crawler / analysis / auth）与本 app 自有的
 * 领域服务（account / admin / data / sync / export / worker / pipeline / radar / scheduler / seed）
 * 汇总成单一入口。控制器 / 守卫 / starters / CoreModule 统一从 `@/domain` 导入；
 * {@link createCore} 装配全套实例，经 CoreModule 按类令牌登记进 NestJS IoC 容器。
 */

// 能力包：基座 / 持久层
export * from '@/lib/kernel';
// env：AppEnv / loadEnv 已从 kernel 大一统 schema 拆到本 app 自有 config（kernel 只留共享 base），经此再导出保持 @/domain 入口不变
export { loadEnv, type AppEnv } from '@/config/env';
export * from '@/lib/db';

// 装配工厂（原 core/factory，迁入 api 后改名 assembly）
export { createCore, type Core } from './assembly';

// 账户 / 管理 / 设备
export * from './account/auth-context';
export * from './account/account.service';
export * from './admin/admin.service';
export * from './auth/device-context';
export * from './auth/device-auth.service';

// 数据浏览
export * from './data/data.service';
export * from './data/query-parse';

// 分析（analyzer 引擎 + 配置/落库）已迁至 @/lib/analysis；过渡期由 core 再导出
export * from '@/lib/analysis';

// 采集（reddit/hn/rss/queue/连接器配置）已迁至 @/lib/crawler；过渡期由 core 再导出
export * from '@/lib/crawler';

// 同步 / 导出
export * from './sync/sync.service';
export * from './export/export.service';
export * from './export/sqlite-writer';

// 执行器 / 派发 / 编排 / 调度（单进程归一：执行能力内嵌本进程，无独立 worker / WS 网关）
export * from './worker/worker.service';
export * from './worker/local-dispatcher';
export * from './pipeline/pipeline.service';
export * from './radar/radar.service';
export * from './scheduler/scheduler.service';

// 种子
export * from './seed/seeder';
export * from './seed/sources.seeder';
export * from './seed/blueprints.seeder';
export * from './seed/processes.seeder';
export * from './seed/super-admin.seeder';
export * from './seed/runtime-settings.seeder';
export * from './seed/seed.runner';

// 鉴权原语（转出 @/lib/auth,供建号 / 工具脚本直接使用；领域服务内部亦用之）
export { hashPassword, verifyPassword } from '@/lib/auth';
