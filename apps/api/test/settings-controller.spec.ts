import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@/database';
import { nowSec } from '@/utils/time';
import { ProvidersRepository, SettingsRepository } from '@/database';
import { type RuntimeSettingsService } from '@/domain/settings/runtime-settings.service';
import { type AnalysisConfigService } from '@/domain/analysis/analysis-config.service';
import { type PipelineService, SettingsService } from '@/domain';
import { ValidationError } from '@/domain/errors';
import { setupTestDb, truncateAll } from './helpers';

// 加解密主密钥（createProvider 入库时加密用），测试用任意高熵串
process.env.SETTINGS_SECRET ||= 'hatch-radar-test-secret-0123456789abcdef';

/**
 * 安全回归：改 baseUrl 必须同时重填 API Key（业务规则在 SettingsService）。
 * 否则攻击者可只改 baseUrl（不带 key）把已入库的明文密钥经 test/分析调用发往任意地址。
 */
describe('SettingsService.updateProvider（改 baseUrl 必须重填 API Key）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let providers: ProvidersRepository;
  let svc: SettingsService;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    providers = new ProvidersRepository(db);
    // 只用到 reloadAnalysisConfig（成功路径触发）；其余不涉及，给空桩即可
    const analysisConfig = {
      reloadAnalysisConfig: async () => {},
    } as unknown as AnalysisConfigService;
    // 本组用例不触及运行期参数 / 入队，空桩即可
    const runtimeSettings = {} as unknown as RuntimeSettingsService;
    svc = new SettingsService(
      providers,
      new SettingsRepository(db),
      analysisConfig,
      {} as unknown as PipelineService,
      runtimeSettings,
    );
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
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        enabled: true,
      },
      'sk-secret-aaaabbbb',
      nowSec(),
    );
  }

  it('改 baseUrl 但不带 apiKey → 拒绝，且库中 baseUrl 不变', async () => {
    const id = await seedOpenAI();
    await expect(
      svc.updateProvider(id, { baseUrl: 'http://evil.example/v1' }),
    ).rejects.toThrow(ValidationError);
    const row = await providers.getProvider(id);
    expect(row!.base_url).toBe('https://api.openai.com/v1'); // 未被改动
  });

  it('改 baseUrl 且同时重填 apiKey → 允许', async () => {
    const id = await seedOpenAI();
    await svc.updateProvider(id, {
      baseUrl: 'https://api.openai.com/v2',
      apiKey: 'sk-new-ccccdddd',
    });
    const row = await providers.getProvider(id);
    expect(row!.base_url).toBe('https://api.openai.com/v2');
  });

  it('不动 baseUrl（仅改 label）→ 允许，无需重填 key', async () => {
    const id = await seedOpenAI();
    await expect(svc.updateProvider(id, { label: 'renamed' })).resolves.toBeUndefined();
  });
});

/** claude_cli 订阅模式：无 API Key，创建免 Key、Key 池端点拒绝。 */
describe('SettingsService（claude_cli 订阅模式：免 Key）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let providers: ProvidersRepository;
  let svc: SettingsService;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    providers = new ProvidersRepository(db);
    const analysisConfig = {
      reloadAnalysisConfig: async () => {},
    } as unknown as AnalysisConfigService;
    const runtimeSettings = {} as unknown as RuntimeSettingsService;
    svc = new SettingsService(
      providers,
      new SettingsRepository(db),
      analysisConfig,
      {} as unknown as PipelineService,
      runtimeSettings,
    );
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('create 不带 apiKey → 成功，且无 Key、base_url 为空', async () => {
    const res = await svc.createProvider({
      provider: 'claude_cli',
      label: 'sub',
      model: 'claude-opus-4-8',
    });
    const withKeys = await providers.getProviderWithKeys(res.id);
    expect(withKeys?.provider.provider).toBe('claude_cli');
    expect(withKeys?.provider.base_url).toBeNull();
    expect(withKeys?.keys).toHaveLength(0);
  });

  it('addKey 对 claude_cli → 拒绝（订阅模式不支持 Key）', async () => {
    const created = await svc.createProvider({ provider: 'claude_cli', label: 'sub', model: 'm' });
    await expect(svc.addKey(created.id, { apiKey: 'sk-x-aaaabbbb' })).rejects.toThrow(
      ValidationError,
    );
  });
});
