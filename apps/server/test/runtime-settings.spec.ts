import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import { RuntimeSettingsService } from '@/config/runtime-settings.service';
import { SettingsRepository } from '@/db/settings.repository';
import { setupTestDb, truncateAll } from './helpers';

// 出厂默认（与 RuntimeSettingsService.DEFAULT_RUNTIME_SETTINGS 对齐）
const DEFAULTS = {
  analyzeBatchSize: 20,
  sessionIdleDays: 7,
  sessionAbsoluteDays: 30,
  workerJobTimeoutMs: 600_000,
  workerStaleSeconds: 300,
};

describe('RuntimeSettingsService（DB 唯一事实源 + 首启播种）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let settings: SettingsRepository;
  let svc: RuntimeSettingsService;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    settings = new SettingsRepository(db);
    svc = new RuntimeSettingsService(settings);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('未播种 / DB 行缺失 → 回落默认常量', async () => {
    expect(await svc.getAnalyzeBatchSize()).toBe(DEFAULTS.analyzeBatchSize);
    expect(await svc.getSessionConfig()).toEqual({ idleDays: 7, absoluteDays: 30 });
    expect(await svc.getWorkerTuning()).toEqual({ jobTimeoutMs: 600_000, staleSeconds: 300 });

    const overview = await svc.getOverview();
    expect(overview.analyzeBatchSize).toEqual({ value: 20, defaultValue: 20 });
    expect(overview.workerStaleSeconds).toEqual({ value: 300, defaultValue: 300 });
  });

  it('ensureSeeded 写入五项默认值；幂等且不覆盖已改值', async () => {
    await svc.ensureSeeded();
    expect(await settings.getSetting('analyze_batch_size')).toBe('20');
    expect(await settings.getSetting('worker_stale_seconds')).toBe('300');

    // 改一项后再次播种：insertIfAbsent 跳过已存在键，不回退
    await svc.applySettings({ analyzeBatchSize: 99 });
    await svc.ensureSeeded();
    expect(await svc.getAnalyzeBatchSize()).toBe(99);
  });

  it('applySettings upsert → 读取与 overview 反映写入值', async () => {
    await svc.applySettings({ analyzeBatchSize: 50, sessionIdleDays: 14, workerStaleSeconds: 120 });

    expect(await svc.getAnalyzeBatchSize()).toBe(50);
    expect(await svc.getSessionConfig()).toEqual({ idleDays: 14, absoluteDays: 30 }); // absolute 未写
    expect(await svc.getWorkerTuning()).toEqual({ jobTimeoutMs: 600_000, staleSeconds: 120 });

    const overview = await svc.getOverview();
    expect(overview.analyzeBatchSize).toEqual({ value: 50, defaultValue: 20 });
    expect(overview.sessionAbsoluteDays).toEqual({ value: 30, defaultValue: 30 });
  });

  it('缺省键不动其它值（partial 语义）', async () => {
    await svc.applySettings({ sessionIdleDays: 3, sessionAbsoluteDays: 9 });
    await svc.applySettings({ sessionIdleDays: 5 }); // 只动 idle
    expect(await svc.getSessionConfig()).toEqual({ idleDays: 5, absoluteDays: 9 });
  });

  it('库中被手改成非法值（越界/非整数）→ 忽略并回落默认', async () => {
    await settings.setSetting('worker_stale_seconds', '5'); // 低于下界 30
    await settings.setSetting('analyze_batch_size', 'abc'); // 非整数

    expect((await svc.getWorkerTuning()).staleSeconds).toBe(300);
    expect(await svc.getAnalyzeBatchSize()).toBe(20);
    expect((await svc.getOverview()).analyzeBatchSize.value).toBe(20);
  });
});
