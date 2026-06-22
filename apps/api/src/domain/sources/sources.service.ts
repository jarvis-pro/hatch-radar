import { Injectable } from '@nestjs/common';
import { CrawlerConfigService } from '@/crawler';
import {
  SourceConnectorsRepository,
  SourcesRepository,
  toConnectorDTO,
  type ConnectorInput,
  type ConnectorUpdate,
  type SourceInput,
  type SourcePlatform,
} from '@/database';
import { isSecretConfigured } from '@/utils/crypto';
import { NotFoundError, ValidationError } from '@/domain/errors';
import { nowSec } from '@/utils/time';
import { logger } from '@/logger';

/**
 * 采集来源（爬虫计划）+ 采集连接器（需鉴权平台的凭据）的领域服务。
 *
 * 从 SourcesController / SourceConnectorsController 抽出的编排与业务规则：
 * Reddit 服务端闸（启用 reddit 来源须存在「可用 reddit 连接器」）、凭据加密前置校验、连通性测试。
 * 业务失败一律抛 DomainError，由全局异常过滤器按 status 映射成 HTTP——领域服务不依赖 HTTP 层。
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

  async createSource(input: SourceInput): Promise<{ id: number }> {
    await this.assertRedditEnable(input.platform, input.enabled !== false);
    const id = await this.sources.createSource(input, nowSec());
    logger.info(`[数据来源] 新增 #${id}：${input.platform}/${input.identifier}`);
    return { id };
  }

  async updateSource(id: number, fields: Partial<SourceInput>): Promise<void> {
    const existing = await this.sources.getSource(id);
    if (!existing) throw new NotFoundError('来源不存在');
    if (fields.enabled === true) {
      await this.assertRedditEnable(existing.platform, true);
    }
    if (Object.keys(fields).length > 0) await this.sources.updateSource(id, fields, nowSec());
  }

  async deleteSource(id: number): Promise<void> {
    if (!(await this.sources.deleteSource(id))) {
      throw new NotFoundError('来源不存在');
    }
    logger.info(`[数据来源] 删除 #${id}`);
  }

  /** Reddit 门禁：平台=reddit 的来源要置 enabled=true，必须已有「可用 reddit 连接器」。 */
  private async assertRedditEnable(platform: SourcePlatform, enabling: boolean): Promise<void> {
    if (
      platform === 'reddit' &&
      enabling &&
      !(await this.connectors.hasUsableConnector('reddit'))
    ) {
      throw new ValidationError(
        'Reddit 来源需先在「采集连接器」配置并测试通过 Reddit 凭据，才能启用',
      );
    }
  }

  // ── 采集连接器 ────────────────────────────────────────────────────────────────

  async createConnector(input: ConnectorInput): Promise<{ id: number }> {
    if (!isSecretConfigured()) {
      throw new ValidationError('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
    }
    const id = await this.connectors.createConnector(input, nowSec());
    logger.info(`[采集连接器] 新增 #${id}：${input.platform}/${input.authKind}`);
    return { id };
  }

  async updateConnector(id: number, fields: ConnectorUpdate): Promise<void> {
    if (fields.secret && !isSecretConfigured()) {
      throw new ValidationError('未配置 SETTINGS_SECRET，无法加密新凭据');
    }
    if (!(await this.connectors.getConnector(id))) {
      throw new NotFoundError('连接器不存在');
    }
    if (Object.keys(fields).length > 0) await this.connectors.updateConnector(id, fields, nowSec());
    logger.info(`[采集连接器] 更新 #${id}`);
  }

  async deleteConnector(id: number): Promise<void> {
    if (!(await this.connectors.deleteConnector(id))) {
      throw new NotFoundError('连接器不存在');
    }
    logger.info(`[采集连接器] 删除 #${id}`);
  }

  /** 连通性测试并记录结果（始终成功返回 { ok, error? }）。 */
  testConnector(id: number) {
    return this.crawlerConfig.testConnector(id);
  }
}
