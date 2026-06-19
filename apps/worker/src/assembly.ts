import type { AppDatabase } from '@hatch-radar/db';
import {
  CommentsRepository,
  InsightsRepository,
  TasksRepository,
  TaskStagesRepository,
  RunsRepository,
  PostsRepository,
  ProvidersRepository,
  RuntimeSettingsService,
  SettingsRepository,
  SourcesRepository,
  SourceConnectorsRepository,
  RequestQueueRepository,
  RequestLanesRepository,
  TranslationsRepository,
} from '@hatch-radar/db';
import { AnalysisConfigService, AnalysisService, TranslationService } from '@hatch-radar/analysis';
import { CrawlerConfigService, HackerNewsClient, TokenBucketQueue } from '@hatch-radar/crawler';
import { CollectionExecutor } from './collection.executor';
import { RequestGate } from './request-gate';
import { WorkerService } from './worker.service';

/**
 * 数据面装配：只构建认领循环所需的最小依赖图——仓储 + runtime-settings + 分析引擎/配置 + WorkerService。
 *
 * AnalysisConfigService 不传 Dispatcher（gateway 可选）：worker 只读配置执行、不入队/不派发，
 * 派发器留空即可。与 api 侧 createCore 的全量装配相对——worker 是薄 runner。
 */
export function createWorkerCore(db: AppDatabase): { worker: WorkerService } {
  const tasks = new TasksRepository(db);
  const taskStages = new TaskStagesRepository(db);
  const runs = new RunsRepository(db);
  const posts = new PostsRepository(db);
  const comments = new CommentsRepository(db);
  const insights = new InsightsRepository(db);
  const providers = new ProvidersRepository(db);
  const settings = new SettingsRepository(db);
  const translations = new TranslationsRepository(db);
  const sources = new SourcesRepository(db);
  const sourceConnectors = new SourceConnectorsRepository(db);
  const requestQueue = new RequestQueueRepository(db);
  const requestLanes = new RequestLanesRepository(db);

  const runtimeSettings = new RuntimeSettingsService(settings);
  const analysis = new AnalysisService(insights);
  const analysisConfig = new AnalysisConfigService(providers, settings, posts);
  const translation = new TranslationService(translations, providers);
  const queue = new TokenBucketQueue();
  const crawlerConfig = new CrawlerConfigService(sourceConnectors, queue);
  const hackernews = new HackerNewsClient();
  const gate = new RequestGate(requestQueue, requestLanes);
  const collection = new CollectionExecutor(
    crawlerConfig,
    hackernews,
    sources,
    posts,
    comments,
    tasks,
    runs,
    analysisConfig,
    gate,
  );
  const worker = new WorkerService(
    tasks,
    taskStages,
    runs,
    posts,
    comments,
    analysis,
    analysisConfig,
    translation,
    runtimeSettings,
    collection,
  );

  return { worker };
}
