import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { DB_HANDLE } from '@/common/tokens';
import { Prisma, type AppDatabase, type DbHandle } from './internal';

/**
 * 事务上下文（Unit of Work）：以 AsyncLocalStorage 传播「当前事务句柄」，让**服务层**把跨多个仓储的
 * 写操作收进单个数据库事务——回调抛错则整体回滚。
 *
 * 仓储无需感知事务：它们注入的 `PRISMA` 是 {@link makeTxAwareClient} 包出的事务感知代理，按本类的 ALS
 * 自动路由到「当前事务句柄」或「根客户端」。故引入本机制对 22 个仓储**零改动**。
 *
 * 典型用法（服务层注入 TxContext）：
 * ```ts
 * await this.tx.run(async () => {
 *   await this.users.updatePassword(...); // 与下一句同生共死（同一事务）
 *   await this.sessions.deleteOthers(...);
 * });
 * ```
 */
@Injectable()
export class TxContext {
  /** 事务句柄 ALS：代理与 {@link run} 共用同一实例，使「是否在事务中」对两者一致可见。 */
  readonly als = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /**
   * 把回调内所有（经 PRISMA 代理的）仓储写操作收进一个事务；回调抛错则整体回滚。
   * **可重入**：已在事务中则直接复用当前事务、不再嵌套开启（PG 不支持事务套事务）。
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) {
      return fn();
    }

    return this.handle.db.$transaction((tx) => this.als.run(tx, fn));
  }
}

/**
 * 事务感知代理：包一层 Prisma 根客户端，每次属性访问按 ALS 路由到「当前事务句柄」或根客户端。
 *
 * - 模型委托（`client.tasks` 等）/ `$queryRaw` 等：转发到当前句柄（在事务中即落事务）；
 * - `$transaction(callback)`：**可重入**——已在事务中则复用（不嵌套）、否则开新事务并登记到 ALS，
 *   使其回调内经代理的仓储调用也落入同一事务。仓储原有的 `this.db.$transaction(...)` 因此自动事务安全。
 */
export function makeTxAwareClient(
  root: AppDatabase,
  als: AsyncLocalStorage<Prisma.TransactionClient>,
): AppDatabase {
  return new Proxy(root, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (arg: unknown, ...rest: unknown[]): Promise<unknown> => {
          const active = als.getStore();
          if (typeof arg === 'function') {
            const cb = arg as (tx: Prisma.TransactionClient) => Promise<unknown>;

            return active ? cb(active) : root.$transaction((tx) => als.run(tx, () => cb(tx)));
          }

          // 数组批量形式（仓储未使用）：交根客户端直跑。
          return (root.$transaction as (a: unknown, ...r: unknown[]) => Promise<unknown>)(
            arg,
            ...rest,
          );
        };
      }

      const base = als.getStore() ?? target;
      const value = Reflect.get(base, prop, base);

      return typeof value === 'function' ? value.bind(base) : value;
    },
  });
}
