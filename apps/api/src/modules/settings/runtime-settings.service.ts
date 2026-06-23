import { Injectable } from '@nestjs/common';
import { SettingsRepository } from '@/database';
import { logger } from '@/logger';

/** 运行期可调项的 camelCase 键（同时用作 web DTO 字段名与 PUT body 字段名） */
export type RuntimeSettingKey =
  | 'analyzeBatchSize'
  | 'sessionIdleDays'
  | 'sessionAbsoluteDays'
  | 'workerJobTimeoutMs'
  | 'workerStaleSeconds'
  | 'translationConcurrency';

/** 僵死回收阈值相对单环节硬超时的安全余量（秒）：须覆盖数个心跳周期，容忍心跳抖动不误回收。 */
const STALE_OVER_TIMEOUT_BUFFER_SEC = 60;

/**
 * 各项默认值——首启播种入 app_settings 的种子，亦作 DB 行缺失时的最后兜底常量。
 * 这是这些参数默认值的唯一事实源（不再经 env）。
 */
const DEFAULT_RUNTIME_SETTINGS: Record<RuntimeSettingKey, number> = {
  analyzeBatchSize: 20,
  sessionIdleDays: 7,
  sessionAbsoluteDays: 30,
  workerJobTimeoutMs: 600_000,
  // 僵死回收阈值须 > 单环节硬超时（见 getWorkerTuning 的运行时下界 enforce）：默认 900s = 600s + 余量。
  workerStaleSeconds: 900,
  // 护栏 B：同时运行的翻译任务数上限（默认 1，挡导出洪峰独占 worker 槽位；分析另有 claim 优先权）
  translationConcurrency: 1,
};

/** 单项元数据：app_settings 存储键 + 整数下界（控制器 DTO 复用同一下界做入参校验） */
interface FieldSpec {
  storageKey: string;
  min: number;
}

/** 五项运行期可调项 → 存储键 / 下界（snake_case 键风格与既有 active_provider_id 等一致） */
const FIELDS: Record<RuntimeSettingKey, FieldSpec> = {
  analyzeBatchSize: { storageKey: 'analyze_batch_size', min: 1 },
  sessionIdleDays: { storageKey: 'session_idle_days', min: 1 },
  sessionAbsoluteDays: { storageKey: 'session_absolute_days', min: 1 },
  workerJobTimeoutMs: { storageKey: 'worker_job_timeout_ms', min: 1000 },
  workerStaleSeconds: { storageKey: 'worker_stale_seconds', min: 30 },
  translationConcurrency: { storageKey: 'translation_concurrency', min: 1 },
};

/** 单项有效态：当前生效值 + 默认值（供设置页展示与「恢复默认」） */
export interface RuntimeFieldState {
  /** 当前生效值（DB 值；DB 行缺失或非法时回落 {@link defaultValue}） */
  value: number;
  /** 出厂默认值（播种值，「恢复默认」即写回此值） */
  defaultValue: number;
}

/** 运行期设置总览（五项有效态） */
export type RuntimeSettingsOverview = Record<RuntimeSettingKey, RuntimeFieldState>;

/**
 * PUT 入参：每项可省略（不变）/ 给整数（写入）。合法性由控制器 zod 把关（整数 + 下界）。
 */
export type RuntimeSettingsPatch = Partial<Record<RuntimeSettingKey, number>>;

/** 解析一条原始库值：缺失 / 非整数 / 低于下界一律视作无效（返回 null，由调用方回落默认） */
function parseOverride(raw: string | undefined, min: number): number | null {
  if (raw == null) {
    return null;
  }

  const n = Number(raw);

  return Number.isInteger(n) && n >= min ? n : null;
}

/**
 * 运行期设置读取层：分析批次 / 会话时长 / worker 调优。DB（app_settings）为唯一事实源，
 * 首启由 {@link ensureSeeded} 播种默认值；不再经 env。
 *
 * 取值实时读库（无缓存）：保存即对本进程与独立 worker 进程的下一次操作生效，无需重启或版本广播；
 * 这些项读取频率低（会话续期限频 60s、worker 回收每分钟、分析入队每小时），实时读库代价可忽略。
 * DB 行缺失（如独立 worker 在主进程播种前先起、或库被清空尚未重启）或被手改成非法值时，
 * 回落 {@link DEFAULT_RUNTIME_SETTINGS} 常量——即播种用的同一默认，杜绝 NaN/崩溃。
 */
@Injectable()
export class RuntimeSettingsService {
  constructor(
    // 全局设置仓储：运行期可调项的 app_settings 键值读写（实时读库、无缓存）
    private readonly settings: SettingsRepository,
  ) {}

  /**
   * 首启幂等播种：五项默认值写入 app_settings（仅当键不存在；绝不覆盖已有值）。
   * 由 RuntimeSettingsSeeder 调用并统一记日志；此处只做写入、回报实际新增条数。
   * @returns 实际新插入的条数（0 表示全部已存在）
   */
  async ensureSeeded(): Promise<number> {
    let inserted = 0;
    for (const key of Object.keys(FIELDS) as RuntimeSettingKey[]) {
      inserted += await this.settings.insertSettingIfAbsent(
        FIELDS[key].storageKey,
        String(DEFAULT_RUNTIME_SETTINGS[key]),
      );
    }

    return inserted;
  }

  /** 读单项有效值（DB 值；缺失/非法回落默认常量） */
  private async readField(key: RuntimeSettingKey): Promise<number> {
    const spec = FIELDS[key];
    const value = parseOverride(await this.settings.getSetting(spec.storageKey), spec.min);

    return value ?? DEFAULT_RUNTIME_SETTINGS[key];
  }

  /** 每轮 AI 分析入队的帖子批次上限 */
  getAnalyzeBatchSize(): Promise<number> {
    return this.readField('analyzeBatchSize');
  }

  /** Web 会话生命周期（天）：空闲过期窗 / 绝对过期窗 */
  async getSessionConfig(): Promise<{ idleDays: number; absoluteDays: number }> {
    const [idleDays, absoluteDays] = await Promise.all([
      this.readField('sessionIdleDays'),
      this.readField('sessionAbsoluteDays'),
    ]);

    return { idleDays, absoluteDays };
  }

  /**
   * 分析 worker 调优：单 job 硬超时（毫秒） / 僵死回收阈值（秒）。
   *
   * 关键不变量：staleSeconds 必须 > 单环节硬超时——否则一个正在合法跑超时（未及 jobTimeoutMs）的环节
   * 会被僵死回收重排、第二个执行体并发启动 → 重复执行（analyze 还会重复付费 AI 调用）。配置值过小
   * （含旧默认 300 < 600）时在此抬到安全下界，从运行时杜绝该反模式。
   */
  async getWorkerTuning(): Promise<{ jobTimeoutMs: number; staleSeconds: number }> {
    const [jobTimeoutMs, staleRaw] = await Promise.all([
      this.readField('workerJobTimeoutMs'),
      this.readField('workerStaleSeconds'),
    ]);
    const minStale = Math.ceil(jobTimeoutMs / 1000) + STALE_OVER_TIMEOUT_BUFFER_SEC;

    return { jobTimeoutMs, staleSeconds: Math.max(staleRaw, minStale) };
  }

  /** 翻译并发上限（护栏 B）：Gateway 认领时传给 claimNextJob，挡导出洪峰占满 worker 槽位 */
  getTranslationConcurrency(): Promise<number> {
    return this.readField('translationConcurrency');
  }

  /** 五项有效态总览（供设置页展示当前值 + 默认值） */
  async getOverview(): Promise<RuntimeSettingsOverview> {
    const keys = Object.keys(FIELDS) as RuntimeSettingKey[];
    const entries = await Promise.all(
      keys.map(async (key) => {
        const spec = FIELDS[key];
        const value = parseOverride(await this.settings.getSetting(spec.storageKey), spec.min);
        const defaultValue = DEFAULT_RUNTIME_SETTINGS[key];
        const state: RuntimeFieldState = { value: value ?? defaultValue, defaultValue };

        return [key, state] as const;
      }),
    );

    return Object.fromEntries(entries) as RuntimeSettingsOverview;
  }

  /**
   * 写入一批运行期参数（upsert）。读取侧实时读库，故保存即生效（含独立 worker 进程的下一次回收/分发）。
   * 「恢复默认」由前端以默认值发起，等同写回出厂值——不删行，DB 始终持有这五项。
   * @param patch 仅含需更新的项（整数）；省略的项保持原值，合法性由控制器 zod 把关
   * @returns 应用后的有效态总览
   */
  async applySettings(patch: RuntimeSettingsPatch): Promise<RuntimeSettingsOverview> {
    const changed: string[] = [];
    for (const key of Object.keys(patch) as RuntimeSettingKey[]) {
      const next = patch[key];
      if (next === undefined) {
        continue;
      }

      await this.settings.setSetting(FIELDS[key].storageKey, String(next));
      changed.push(`${key}=${next}`);
    }

    if (changed.length > 0) {
      logger.info(`[设置] 运行期参数更新（即时生效）：${changed.join('、')}`);
    }

    return this.getOverview();
  }
}
