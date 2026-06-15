/**
 * 种子机制契约：一个 {@link Seeder} 策略接口 + 一个编排器（见 seed.runner.ts）。
 * 与 NestJS 版一致，仅去掉 SEEDERS 注入令牌——Midway 下 SeedRunner 直接注入三个 Seeder 聚合
 * （Midway 无 Angular 式 multi-provider 工厂，改为显式注入，行为等价）。
 */

/** 一次启动内统一下传给所有 Seeder 的上下文（当前仅时间，预留扩展位） */
export interface SeedContext {
  /** 本次启动只取一次的 Unix 秒：保证同批种子时间戳一致，且单测可注入 */
  readonly now: number;
}

/** 单个 Seeder 的执行结果（结构化，供 runner 统一记录） */
export type SeedOutcome =
  | { status: 'seeded'; detail: string } // 实际写入了数据
  | { status: 'skipped'; reason: string }; // 幂等命中 / 前置不满足，未写入

/**
 * 种子策略：一类启动引导数据的幂等播种器。
 * 实现须保证 run() 幂等（可安全重复调用）——幂等判断在实现内部完成。
 */
export interface Seeder {
  /** 稳定标识，用于日志与排序追溯（kebab-case） */
  readonly name: string;
  /** 执行顺序，小者先；无依赖关系的可同值（同值间顺序不保证） */
  readonly order: number;
  /** 失败是否阻断启动：true → 向上抛中止 bootstrap；false → 记 warn 后继续下一个 */
  readonly critical: boolean;
  /** 幂等播种。内部自查前置（表空 / 配置齐全），返回本次结果 */
  run(ctx: SeedContext): Promise<SeedOutcome>;
}
