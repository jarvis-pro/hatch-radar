import { Injectable } from '@nestjs/common';
import { CrawlerConfigService } from '@/lib/crawler';
import {
  SourceConnectorsRepository,
  SourcesRepository,
  toConnectorDTO,
  type ConnectorInput,
  type ConnectorUpdate,
  type SourceInput,
  type SourcePlatform,
} from '@/lib/db';
import { isSecretConfigured, nowSec } from '@/lib/kernel';
import { logger } from '@/logger';

/** 业务规则失败（控制器据 status/message 抛对应 HTTP 异常）。 */
type Fail = { ok: false; status: number; message: string };

/**
 * 采集来源（爬虫计划）+ 采集连接器（需鉴权平台的凭据）的领域服务。
 *
 * 从 SourcesController / SourceConnectorsController 抽出的编排与业务规则：
 * Reddit 服务端闸（启用 reddit 来源须存在「可用 reddit 连接器」）、凭据加密前置校验、连通性测试。
 * 失败以结果对象返回（`{ ok:false, status, message }`），控制器翻译为 HTTP 异常——领域服务不依赖 HTTP 层。
 */
@Injectable()
export class SourcesService {
  constructor(
    private readonly sources: SourcesRepository,
    private readonly connectors: SourceConnectorsRepository,
    private readonly crawlerConfig: CrawlerConfigService,
  ) {}

  // ── 来源 ─────────────────────────────────────────────────────────────────────

  /** 来源列表 + 连接器（脱敏）+ redditUsable + secretConfigured。 */
  async overview() {
    const [sourceRows, connectorRows, redditUsable] = await Promise.all([
      this.sources.listSources(),
      this.connectors.listConnectors(),
      this.connectors.hasUsableConnector('reddit'),
    ]);
    return {
      sources: sourceRows,
      connectors: connectorRows.map(toConnectorDTO),
      redditUsable,
      secretConfigured: isSecretConfigured(),
    };
  }

  async createSource(input: SourceInput): Promise<{ ok: true; id: number } | Fail> {
    const gate = await this.assertRedditEnable(input.platform, input.enabled !== false);
    if (gate) return gate;
    const id = await this.sources.createSource(input, nowSec());
    logger.info(`[数据来源] 新增 #${id}：${input.platform}/${input.identifier}`);
    return { ok: true, id };
  }

  async updateSource(id: number, fields: Partial<SourceInput>): Promise<{ ok: true } | Fail> {
    const existing = await this.sources.getSource(id);
    if (!existing) return { ok: false, status: 404, message: '来源不存在' };
    if (fields.enabled === true) {
      const gate = await this.assertRedditEnable(existing.platform, true);
      if (gate) return gate;
    }
    if (Object.keys(fields).length > 0) await this.sources.updateSource(id, fields, nowSec());
    return { ok: true };
  }

  async deleteSource(id: number): Promise<{ ok: true } | Fail> {
    if (!(await this.sources.deleteSource(id))) {
      return { ok: false, status: 404, message: '来源不存在' };
    }
    logger.info(`[数据来源] 删除 #${id}`);
    return { ok: true };
  }

  /** Reddit 门禁：平台=reddit 的来源要置 enabled=true，必须已有「可用 reddit 连接器」。 */
  private async assertRedditEnable(
    platform: SourcePlatform,
    enabling: boolean,
  ): Promise<Fail | null> {
    if (
      platform === 'reddit' &&
      enabling &&
      !(await this.connectors.hasUsableConnector('reddit'))
    ) {
      return {
        ok: false,
        status: 400,
        message: 'Reddit 来源需先在「采集连接器」配置并测试通过 Reddit 凭据，才能启用',
      };
    }
    return null;
  }

  // ── 采集连接器 ────────────────────────────────────────────────────────────────

  async createConnector(input: ConnectorInput): Promise<{ ok: true; id: number } | Fail> {
    if (!isSecretConfigured()) {
      return {
        ok: false,
        status: 400,
        message: '未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置',
      };
    }
    const id = await this.connectors.createConnector(input, nowSec());
    logger.info(`[采集连接器] 新增 #${id}：${input.platform}/${input.authKind}`);
    return { ok: true, id };
  }

  async updateConnector(id: number, fields: ConnectorUpdate): Promise<{ ok: true } | Fail> {
    if (fields.secret && !isSecretConfigured()) {
      return { ok: false, status: 400, message: '未配置 SETTINGS_SECRET，无法加密新凭据' };
    }
    if (!(await this.connectors.getConnector(id))) {
      return { ok: false, status: 404, message: '连接器不存在' };
    }
    if (Object.keys(fields).length > 0) await this.connectors.updateConnector(id, fields, nowSec());
    logger.info(`[采集连接器] 更新 #${id}`);
    return { ok: true };
  }

  async deleteConnector(id: number): Promise<{ ok: true } | Fail> {
    if (!(await this.connectors.deleteConnector(id))) {
      return { ok: false, status: 404, message: '连接器不存在' };
    }
    logger.info(`[采集连接器] 删除 #${id}`);
    return { ok: true };
  }

  /** 连通性测试并记录结果（始终成功返回 { ok, error? }）。 */
  testConnector(id: number) {
    return this.crawlerConfig.testConnector(id);
  }
}
