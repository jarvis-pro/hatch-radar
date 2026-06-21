import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import { AnalysisConfigService } from '@/lib/analysis';
import { PostsRepository } from '@hatch-radar/db';
import { ProvidersRepository } from '@hatch-radar/db';
import { SettingsRepository } from '@hatch-radar/db';
import { nowSec } from '@hatch-radar/kernel';
import { setupTestDb, truncateAll } from './helpers';

// 模型密钥加解密需要主密钥；测试用任意高熵串即可（不连模型）
process.env.SETTINGS_SECRET ||= 'hatch-radar-test-secret-0123456789abcdef';

/** 用真实仓储构造一个 AnalysisConfigService（gateway 可选，测试不传） */
function makeService(db: AppDatabase): AnalysisConfigService {
  return new AnalysisConfigService(
    new ProvidersRepository(db),
    new SettingsRepository(db),
    new PostsRepository(db),
  );
}

/**
 * 跨进程热重载：HTTP 进程与独立 worker 进程各持一份处理器缓存，
 * 靠库中 analysis_config_version 感知对方的设置写操作。
 */
describe('AnalysisConfigService（跨进程热重载 / config_version 缓存失效）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let httpSvc: AnalysisConfigService; // 模拟 HTTP 进程（执行设置写操作）
  let workerSvc: AnalysisConfigService; // 模拟独立 worker 进程（独立缓存实例）

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    httpSvc = makeService(db);
    workerSvc = makeService(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('HTTP 进程改模型 + reload 后，独立 worker 进程下个任务即用新配置', async () => {
    const providers = new ProvidersRepository(db);
    const id = await providers.createProvider(
      { provider: 'anthropic', label: 'a', model: 'model-old', enabled: true },
      'sk-test-aaaabbbbcccc',
      nowSec(),
    );

    // worker 先构建并缓存处理器（旧模型）
    const before = await workerSvc.getProcessorForProvider(id);
    expect(before?.model).toBe('model-old');

    // HTTP 进程改模型并热重载（递增共享 config 版本）
    await providers.updateProvider(id, { model: 'model-new' }, nowSec());
    await httpSvc.reloadAnalysisConfig();

    // worker 不重启，下次解析即拿到新模型（旧实现会返回缓存的 model-old）
    const after = await workerSvc.getProcessorForProvider(id);
    expect(after?.model).toBe('model-new');
  });

  it('未发生设置写操作时，处理器缓存保持复用（同一实例同一对象）', async () => {
    const providers = new ProvidersRepository(db);
    const id = await providers.createProvider(
      { provider: 'anthropic', label: 'a', model: 'm', enabled: true },
      'sk-test-aaaabbbbcccc',
      nowSec(),
    );
    const p1 = await workerSvc.getProcessorForProvider(id);
    const p2 = await workerSvc.getProcessorForProvider(id);
    expect(p1).toBe(p2); // 同一缓存对象，未被无谓重建
  });

  it('claude_cli 订阅模式：无 Key 也能解析处理器（不走多 Key 故障转移）', async () => {
    const providers = new ProvidersRepository(db);
    const id = await providers.createProvider(
      { provider: 'claude_cli', label: 'sub', model: 'claude-opus-4-8', enabled: true },
      null, // 订阅模式无首把 Key
      nowSec(),
    );
    // 用全新 service（空处理器缓存）：本用例直连仓储建模型、未经控制器 reload 递增 config 版本，
    // 复用 workerSvc 可能命中上个用例同 id 的陈旧缓存。
    const svc = makeService(db);
    const proc = await svc.getProcessorForProvider(id);
    expect(proc?.model).toBe('claude-opus-4-8');
    // 走 createProcessor 的订阅分支（label 'Claude CLI (...)'），而非 Key 故障转移
    expect(proc?.label).toContain('Claude CLI');
  });
});
