import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import type { AnalysisConfigService } from '../src/analysis/analysis-config.service';
import { ProvidersRepository } from '../src/db/providers.repository';
import { SettingsRepository } from '../src/db/settings.repository';
import { SettingsController } from '../src/http/settings.controller';
import { nowSec } from '../src/utils/time';
import { setupTestDb, truncateAll } from './helpers';

// 加解密主密钥（createProvider 入库时加密用），测试用任意高熵串
process.env.SETTINGS_SECRET ||= 'hatch-radar-test-secret-0123456789abcdef';

/**
 * 安全回归：改 baseUrl 必须同时重填 API Key。
 * 否则攻击者可只改 baseUrl（不带 key）把已入库的明文密钥经 test/分析调用发往任意地址。
 */
describe('SettingsController.update（改 baseUrl 必须重填 API Key）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let providers: ProvidersRepository;
  let controller: SettingsController;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    providers = new ProvidersRepository(db);
    // 只用到 reloadAnalysisConfig（成功路径触发）；其余不涉及，给空桩即可
    const analysisConfig = {
      reloadAnalysisConfig: async () => {},
    } as unknown as AnalysisConfigService;
    controller = new SettingsController(providers, new SettingsRepository(db), analysisConfig);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  function seedOpenAI(): Promise<number> {
    return providers.createProvider(
      {
        provider: 'openai',
        label: 'o',
        apiKey: 'sk-secret-aaaabbbb',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        enabled: true,
      },
      nowSec(),
    );
  }

  it('改 baseUrl 但不带 apiKey → 拒绝，且库中 baseUrl 不变', async () => {
    const id = await seedOpenAI();
    await expect(controller.update(id, { baseUrl: 'http://evil.example/v1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const row = await providers.getProvider(id);
    expect(row!.base_url).toBe('https://api.openai.com/v1'); // 未被改动
  });

  it('改 baseUrl 且同时重填 apiKey → 允许', async () => {
    const id = await seedOpenAI();
    const res = await controller.update(id, {
      baseUrl: 'https://api.openai.com/v2',
      apiKey: 'sk-new-ccccdddd',
    });
    expect(res).toEqual({ ok: true });
    const row = await providers.getProvider(id);
    expect(row!.base_url).toBe('https://api.openai.com/v2');
  });

  it('不动 baseUrl（仅改 label）→ 允许，无需重填 key', async () => {
    const id = await seedOpenAI();
    const res = await controller.update(id, { label: 'renamed' });
    expect(res).toEqual({ ok: true });
  });
});
