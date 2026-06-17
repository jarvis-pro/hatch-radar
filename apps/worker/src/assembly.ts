import type { AppDatabase } from '@hatch-radar/db';
import {
  CommentsRepository,
  InsightsRepository,
  JobsRepository,
  PostsRepository,
  ProvidersRepository,
  RuntimeSettingsService,
  SettingsRepository,
  TranslationsRepository,
} from '@hatch-radar/db';
import { AnalysisConfigService, AnalysisService, TranslationService } from '@hatch-radar/analysis';
import { WorkerService } from './worker.service';

/**
 * 数据面装配：只构建认领循环所需的最小依赖图——仓储 + runtime-settings + 分析引擎/配置 + WorkerService。
 *
 * AnalysisConfigService 不传 Dispatcher（gateway 可选）：worker 只读配置执行、不入队/不派发，
 * 派发器留空即可。与 api 侧 createCore 的全量装配相对——worker 是薄 runner。
 */
export function createWorkerCore(db: AppDatabase): { worker: WorkerService } {
  const jobs = new JobsRepository(db);
  const posts = new PostsRepository(db);
  const comments = new CommentsRepository(db);
  const insights = new InsightsRepository(db);
  const providers = new ProvidersRepository(db);
  const settings = new SettingsRepository(db);
  const translations = new TranslationsRepository(db);

  const runtimeSettings = new RuntimeSettingsService(settings);
  const analysis = new AnalysisService(insights);
  const analysisConfig = new AnalysisConfigService(providers, settings, jobs, posts);
  const translation = new TranslationService(translations, providers);
  const worker = new WorkerService(
    jobs,
    posts,
    comments,
    analysis,
    analysisConfig,
    translation,
    runtimeSettings,
  );

  return { worker };
}
