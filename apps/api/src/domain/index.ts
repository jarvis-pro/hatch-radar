/**
 * apps/api 领域桶（domain）：把能力包（kernel / db / crawler / analysis / auth）与本 app 自有的
 * 领域服务（account / admin / data / sync / export / gateway / scheduler / seed / worker）
 * 汇总成单一入口。控制器 / 守卫 / starters / CoreModule 统一从 `@/domain` 导入；
 * {@link createCore} 装配全套实例，经 CoreModule 按类令牌登记进 NestJS IoC 容器。
 */

// 能力包：基座 / 持久层
export * from '@hatch-radar/kernel';
export * from '@hatch-radar/db';

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

// 分析（analyzer 引擎 + 配置/落库）已迁至 @hatch-radar/analysis；过渡期由 core 再导出
export * from '@hatch-radar/analysis';

// 采集（reddit/hn/rss/queue/连接器配置）已迁至 @hatch-radar/crawler；过渡期由 core 再导出
export * from '@hatch-radar/crawler';

// 同步 / 导出
export * from './sync/sync.service';
export * from './export/export.service';
export * from './export/sqlite-writer';

// 网关 / 调度 / worker 执行
export * from './gateway/gateway.service';
export * from './scheduler/scheduler.service';
export * from './worker/worker.service';
export * from './worker/worker-agent';

// 种子
export * from './seed/seeder';
export * from './seed/sources.seeder';
export * from './seed/super-admin.seeder';
export * from './seed/runtime-settings.seeder';
export * from './seed/seed.runner';

// 鉴权原语（转出 @hatch-radar/auth,供建号 / 工具脚本直接使用；领域服务内部亦用之）
export { hashPassword, verifyPassword } from '@hatch-radar/auth';
