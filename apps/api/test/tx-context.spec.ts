import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BlueprintsRepository, TxContext, makeTxAwareClient, type DbHandle } from '@/database';
import { setupTestDb, truncateAll } from './helpers';

/**
 * Unit of Work 回归：事务感知代理（makeTxAwareClient）+ TxContext.run 的传播 / 回滚 / 可重入。
 * 仓储经代理注入，写操作在 run 内自动落当前事务——这是「服务层组合跨仓储事务」的正确性根基。
 */
describe('TxContext（Unit of Work）', () => {
  let handle: DbHandle;
  let tx: TxContext;
  let blueprints: BlueprintsRepository;

  beforeAll(() => {
    handle = setupTestDb();
    tx = new TxContext(handle); // @Inject 仅装饰元数据，直接传 handle 即可
    blueprints = new BlueprintsRepository(makeTxAwareClient(handle.db, tx.als));
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(handle.db);
  });

  it('run 内抛错 → 已写入整体回滚（跨调用原子性）', async () => {
    await expect(
      tx.run(async () => {
        await blueprints.createBlueprint({ kind: 'collect', label: 'a' }, 1);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await blueprints.listBlueprints()).toHaveLength(0);
  });

  it('run 成功 → 提交可见', async () => {
    await tx.run(async () => {
      await blueprints.createBlueprint({ kind: 'collect', label: 'a' }, 1);
    });
    expect(await blueprints.listBlueprints()).toHaveLength(1);
  });

  it('可重入：嵌套 run 复用同一事务，外层回滚连带内层全回滚', async () => {
    await expect(
      tx.run(async () => {
        await blueprints.createBlueprint({ kind: 'collect', label: 'outer' }, 1);
        await tx.run(async () => {
          await blueprints.createBlueprint({ kind: 'recheck', label: 'inner' }, 1);
        });
        throw new Error('rollback all');
      }),
    ).rejects.toThrow('rollback all');
    expect(await blueprints.listBlueprints()).toHaveLength(0);
  });

  it('无事务时仓储照常直写（代理回落根客户端）', async () => {
    await blueprints.createBlueprint({ kind: 'collect', label: 'direct' }, 1);
    expect(await blueprints.listBlueprints()).toHaveLength(1);
  });
});
