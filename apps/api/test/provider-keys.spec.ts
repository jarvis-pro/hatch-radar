import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@/database';
import { ProvidersRepository, toProviderDTO } from '@/database';
import { nowSec } from '@/utils/time';
import { setupTestDb, truncateAll } from './helpers';

// 加解密主密钥（Key 入库时加密用），测试用任意高熵串
process.env.SETTINGS_SECRET ||= 'hatch-radar-test-secret-0123456789abcdef';

/**
 * 多 Key 故障转移的库层基石：Key 池的选取顺序、限流冷却/失效的排除与到点恢复、复位、脱敏。
 * （真正的「逐把切换」走模型调用，需联网，不在此单测；此处验证其依赖的可用 Key 选取语义。）
 */
describe('ProvidersRepository（多 Key 池 / 可用性选取）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let repo: ProvidersRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    repo = new ProvidersRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  /** 建一条 openai 配置（自带一把 primary Key），返回 { providerId, primaryId } */
  async function seed(): Promise<{ providerId: number; primaryId: number }> {
    const providerId = await repo.createProvider(
      { provider: 'openai', label: 'o', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      'sk-primary-aaaabbbb',
      nowSec(),
    );
    const [primary] = await repo.listKeysForProvider(providerId);

    return { providerId, primaryId: primary.id };
  }

  it('createProvider 自带一把 primary Key（priority 0、active）', async () => {
    const { providerId } = await seed();
    const keys = await repo.listKeysForProvider(providerId);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      label: 'primary',
      priority: 0,
      enabled: true,
      status: 'active',
    });
  });

  it('listUsableKeys 按 priority 升序；排除停用 Key', async () => {
    const { providerId, primaryId } = await seed();
    const backupId = await repo.createKey(
      providerId,
      { apiKey: 'sk-backup-ccccdddd', label: 'backup', priority: 1 },
      nowSec(),
    );
    expect((await repo.listUsableKeys(providerId, nowSec())).map((k) => k.id)).toEqual([
      primaryId,
      backupId,
    ]);

    await repo.updateKey(primaryId, { enabled: false }, nowSec());
    expect((await repo.listUsableKeys(providerId, nowSec())).map((k) => k.id)).toEqual([backupId]);
  });

  it('cooling 未到点排除、到点恢复；invalid 始终排除、reset 复位', async () => {
    const { providerId, primaryId } = await seed();
    const now = nowSec();

    // 冷却到未来：排除；冷却到过去（已解冻）：仍可用
    await repo.markKeyCooling(primaryId, now + 600, 'rate limited', now);
    expect(await repo.countUsableKeys(providerId, now)).toBe(0);
    await repo.markKeyCooling(primaryId, now - 1, 'rate limited', now);
    expect(await repo.countUsableKeys(providerId, now)).toBe(1);

    // 失效：始终排除，直到人工 reset
    await repo.markKeyInvalid(primaryId, '401 unauthorized', now);
    expect(await repo.countUsableKeys(providerId, now)).toBe(0);
    const [k] = await repo.listKeysForProvider(providerId);
    expect(k.status).toBe('invalid');
    expect(k.last_error).toContain('401');

    await repo.updateKey(primaryId, { reset: true }, now);
    const [reset] = await repo.listKeysForProvider(providerId);
    expect(reset.status).toBe('active');
    expect(reset.cooldown_until).toBeNull();
    expect(reset.last_error).toBeNull();
    expect(await repo.countUsableKeys(providerId, now)).toBe(1);
  });

  it('toProviderDTO 仅暴露脱敏 Key，绝不含明文', async () => {
    const { providerId } = await seed();
    const dto = toProviderDTO((await repo.getProviderWithKeys(providerId))!);
    expect(dto).not.toHaveProperty('keys.0.api_key');
    expect(dto.keys[0].keyMasked).toMatch(/…/);
    expect(JSON.stringify(dto)).not.toContain('sk-primary-aaaabbbb');
  });
});
