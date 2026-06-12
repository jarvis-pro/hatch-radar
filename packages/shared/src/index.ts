/**
 * @hatch-radar/shared —— 跨端共享层。
 *
 * 只放五类东西（保持零运行时依赖，Node / Next.js / React Native 均可直接 import）：
 * 1. 数据库 DDL（schema.ts；triage 表见 triage.ts）
 * 2. 数据行类型与洞察域类型（posts / comments / insights）
 * 3. 人工研判结构（triage.ts，移动端本地与服务端同步落库共用）
 * 4. 导出批次协议类型（export.ts）
 * 5. App ⇄ 工作台同步协议类型（sync.ts）
 *
 * better-sqlite3 等原生模块、AI SDK、抓取逻辑一律不进入本包。
 */
export * from './schema';
export * from './posts';
export * from './comments';
export * from './insights';
export * from './triage';
export * from './export';
export * from './sync';
