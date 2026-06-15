/**
 * @hatch-radar/crawler —— 采集层。
 *
 * Reddit / HackerNews / RSS 抓取客户端 + 令牌桶限速队列 + 采集连接器配置服务。
 * 抓取产物统一映射为 @hatch-radar/shared 的通用 ingestion 结构（RedditPost / RedditComment）；
 * 依赖 db（读连接器凭据 / sourceConnectors 仓储）+ kernel（日志 / 时间）。
 */
export * from './reddit';
export * from './hackernews';
export * from './rss';
export * from './queue';
export * from './crawler-config.service';
