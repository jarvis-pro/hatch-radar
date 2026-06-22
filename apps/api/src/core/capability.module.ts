import { Global, Module, type Provider } from '@nestjs/common';
import { type AppEnv } from '@/config/env';
import { APP_ENV, WORKER_CONCURRENCY } from '@/common/tokens';
import { RequestLanesRepository, RequestQueueRepository } from '@/database';
import { CrawlerConfigService, HackerNewsClient, TokenBucketQueue } from '@/crawler';
import { RequestGate, RuntimeSettingsService } from '@/domain';

/**
 * 能力模块（全局）：无状态能力 / 运行期配置读取叶子，被多域广泛依赖。
 *
 * 提供：
 * - `HackerNewsClient`（零依赖采集客户端）、`CrawlerConfigService`（依赖 SourceConnectorsRepository +
 *   TokenBucketQueue）；
 * - `RuntimeSettingsService`（仅依赖 SettingsRepository，读 app_settings 运行期可调项）；
 * - 三个工厂 provider：`WORKER_CONCURRENCY`（从 APP_ENV 派生）、`TokenBucketQueue`（末位 options 带默认值，
 *   故工厂构造）、`RequestGate`（注入两个出站请求闸仓储，末位 options 带默认值）。
 *
 * 依赖只指向 @Global 叶子：仓储来自 RepositoryModule（@Global）、APP_ENV 来自 AppConfigModule（@Global）、
 * PRISMA 来自 DatabaseModule（@Global）。不依赖任何 feature module，彼此与 RepositoryModule 不互依赖——是 DAG。
 */
const CAPABILITY_CLASSES = [HackerNewsClient, CrawlerConfigService, RuntimeSettingsService];

const FACTORY_PROVIDERS: Provider[] = [
  // 内嵌执行器并发上限：从 APP_ENV 派生供 LocalDispatcher（WorkerModule）注入
  {
    provide: WORKER_CONCURRENCY,
    useFactory: (env: AppEnv): number => env.workerConcurrency,
    inject: [APP_ENV],
  },
  // 末位构造参数是带默认值的 options（非 DI 依赖），故经工厂构造而非自动注入
  { provide: TokenBucketQueue, useFactory: (): TokenBucketQueue => new TokenBucketQueue() },
  {
    provide: RequestGate,
    useFactory: (queue: RequestQueueRepository, lanes: RequestLanesRepository): RequestGate =>
      new RequestGate(queue, lanes),
    inject: [RequestQueueRepository, RequestLanesRepository],
  },
];

@Global()
@Module({
  providers: [...FACTORY_PROVIDERS, ...CAPABILITY_CLASSES],
  exports: [WORKER_CONCURRENCY, TokenBucketQueue, RequestGate, ...CAPABILITY_CLASSES],
})
export class CapabilityModule {}
