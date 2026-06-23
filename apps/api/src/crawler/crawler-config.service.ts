import { Injectable } from '@nestjs/common';
import {
  SourceConnectorsRepository,
  decryptConnectorSecret,
  type SourceConnectorRow,
} from '@/database';
import { nowSec } from '@/utils/time';
import { errMsg } from '@/utils/error';
import { logger } from '@/logger';
import { TokenBucketQueue } from './queue';
import { RedditClient, type RedditConfig } from './reddit';

/**
 * 采集运行期配置层：把 source_connectors 行解析成 Reddit 客户端、跑连通性测试。
 *
 * Reddit 客户端按「可用连接器」(enabled 且 last_check_ok) 惰性构建，并按连接器
 * 指纹(id+updated_at)缓存：连接器一改（updated_at 变）下次取用即重建——保存即生效，无需重启。
 * 凭据一律来自 DB（已彻底移出 env）。来源列表的首启播种已收拢到 SeedModule（SourcesSeeder）。
 */
@Injectable()
export class CrawlerConfigService {
  /** 缓存的 Reddit 客户端及其来源连接器指纹；指纹变化即重建 */
  private cached: { fingerprint: string; client: RedditClient } | null = null;

  constructor(
    private readonly connectors: SourceConnectorsRepository,
    private readonly queue: TokenBucketQueue,
  ) {}

  /**
   * 取当前可用的 Reddit 客户端（按可用连接器构建，带指纹缓存）。
   * @returns 无可用 reddit 连接器时返回 null（scan/comments 将跳过 Reddit）
   */
  async getRedditClient(): Promise<RedditClient | null> {
    const conn = await this.connectors.getUsableConnector('reddit');
    if (!conn) {
      this.cached = null;

      return null;
    }

    const fingerprint = `${conn.id}:${conn.updated_at}`;
    if (this.cached?.fingerprint === fingerprint) {
      return this.cached.client;
    }

    const cfg = this.toRedditConfig(conn);
    if (!cfg) {
      this.cached = null;

      return null;
    }

    const client = new RedditClient(this.queue, cfg);
    this.cached = { fingerprint, client };

    return client;
  }

  /** 把连接器密文凭据解密为 RedditConfig；字段缺失/解密失败返回 null（不崩调度） */
  private toRedditConfig(conn: SourceConnectorRow): RedditConfig | null {
    try {
      const s = decryptConnectorSecret(conn);
      const cfg: RedditConfig = {
        clientId: String(s.clientId ?? ''),
        clientSecret: String(s.clientSecret ?? ''),
        username: String(s.username ?? ''),
        password: String(s.password ?? ''),
        userAgent: String(s.userAgent ?? ''),
      };
      if (!cfg.clientId || !cfg.clientSecret || !cfg.username || !cfg.password || !cfg.userAgent) {
        logger.warn(`[crawler] Reddit 连接器 #${conn.id} 凭据不完整，跳过`);

        return null;
      }

      return cfg;
    } catch (err) {
      logger.warn(`[crawler] Reddit 连接器 #${conn.id} 解密失败：${errMsg(err)}`);

      return null;
    }
  }

  /**
   * 连通性测试某连接器并记录结果（门禁依赖 last_check_ok）。
   * - reddit：尝试取 OAuth token；成功后失效客户端缓存，使新凭据下次抓取即生效
   * @returns ok 与可选错误信息（不抛出）
   */
  async testConnector(id: number): Promise<{ ok: boolean; error?: string }> {
    const conn = await this.connectors.getConnector(id);
    if (!conn) {
      return { ok: false, error: '连接器不存在' };
    }

    if (conn.platform !== 'reddit') {
      // 其余平台无需凭据；标记通过即可（理论上不会有非 reddit 连接器）
      await this.connectors.recordCheck(id, true, null, nowSec());

      return { ok: true };
    }

    const cfg = this.toRedditConfig(conn);
    if (!cfg) {
      await this.connectors.recordCheck(id, false, '凭据不完整或解密失败', nowSec());

      return { ok: false, error: '凭据不完整或解密失败' };
    }

    try {
      await new RedditClient(this.queue, cfg).testAuth();
      await this.connectors.recordCheck(id, true, null, nowSec());
      this.cached = null; // 凭据可能已变，失效缓存指纹，下次重建

      return { ok: true };
    } catch (err) {
      const m = errMsg(err);
      await this.connectors.recordCheck(id, false, m, nowSec());

      return { ok: false, error: m };
    }
  }
}
