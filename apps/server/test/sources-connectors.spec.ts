import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import {
  decryptConnectorSecret,
  nowSec,
  SourceConnectorsRepository,
  SourcesRepository,
  toConnectorDTO,
} from '@hatch-radar/core';
import { SourcesController } from '@/http/sources.controller';
import { setupTestDb, truncateAll } from './helpers';

// 连接器凭据加解密需要主密钥；测试用任意高熵串
process.env.SETTINGS_SECRET ||= 'hatch-radar-test-secret-0123456789abcdef';

const REDDIT_SECRET = {
  clientId: 'cid-abc123',
  clientSecret: 'csecret-xyz789',
  username: 'u_test',
  password: 'pw_test',
  userAgent: 'hatch-radar/1.0 (by /u/u_test)',
};

describe('数据来源 / 采集连接器（仓储 + Reddit 门禁）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let sources: SourcesRepository;
  let connectors: SourceConnectorsRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    sources = new SourcesRepository(db);
    connectors = new SourceConnectorsRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('连接器凭据加密入库、DTO 脱敏不外发明文、解密可还原', async () => {
    const id = await connectors.createConnector(
      { platform: 'reddit', authKind: 'oauth', secret: REDDIT_SECRET, label: '主账号' },
      nowSec(),
    );
    const row = (await connectors.getConnector(id))!;
    // 入库为密文，绝不等于明文
    expect(row.secret).not.toContain('csecret-xyz789');
    // 解密可还原
    expect(decryptConnectorSecret(row)).toMatchObject(REDDIT_SECRET);
    // DTO 脱敏：含摘要、不含任何明文密钥字段
    const dto = toConnectorDTO(row);
    expect(dto.summary).toContain('u/u_test');
    expect(JSON.stringify(dto)).not.toContain('csecret-xyz789');
    expect(JSON.stringify(dto)).not.toContain('pw_test');
  });

  it('连接器须测试通过才「可用」；改 secret 清空测试结果', async () => {
    const id = await connectors.createConnector(
      { platform: 'reddit', authKind: 'oauth', secret: REDDIT_SECRET },
      nowSec(),
    );
    // 新建即未测试 → 不可用
    expect(await connectors.hasUsableConnector('reddit')).toBe(false);
    expect(await connectors.getUsableConnector('reddit')).toBeUndefined();

    await connectors.recordCheck(id, true, null, nowSec());
    expect(await connectors.hasUsableConnector('reddit')).toBe(true);

    // 停用 → 不可用
    await connectors.updateConnector(id, { enabled: false }, nowSec());
    expect(await connectors.hasUsableConnector('reddit')).toBe(false);

    // 重新启用 + 改 secret → 测试结果被清空，重新不可用（须重测）
    await connectors.updateConnector(id, { enabled: true, secret: REDDIT_SECRET }, nowSec());
    expect(await connectors.hasUsableConnector('reddit')).toBe(false);
    expect((await connectors.getConnector(id))!.last_check_ok).toBeNull();
  });

  it('来源按平台列启用项；countSources 供首启播种判断', async () => {
    expect(await sources.countSources()).toBe(0);
    await sources.createSource(
      { platform: 'hackernews', identifier: 'askstories', label: 'ask_hn' },
      nowSec(),
    );
    await sources.createSource(
      { platform: 'rss', identifier: 'https://x.com/f', label: 'x', enabled: false },
      nowSec(),
    );
    expect(await sources.countSources()).toBe(2);
    expect((await sources.listEnabledByPlatform('hackernews')).map((s) => s.identifier)).toEqual([
      'askstories',
    ]);
    expect(await sources.listEnabledByPlatform('rss')).toHaveLength(0); // 停用的不返回
  });

  it('Reddit 门禁：无可用连接器时启用 reddit 来源被拒，配齐后放行', async () => {
    const controller = new SourcesController(sources, connectors);
    // 建一个停用的 reddit 来源
    const srcId = await sources.createSource(
      { platform: 'reddit', identifier: 'startups', enabled: false },
      nowSec(),
    );
    // 无连接器 → 启用被拒
    await expect(controller.update(srcId, { enabled: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((await sources.getSource(srcId))!.enabled).toBe(false);

    // 配 reddit 连接器并测试通过 → 放行
    const connId = await connectors.createConnector(
      { platform: 'reddit', authKind: 'oauth', secret: REDDIT_SECRET },
      nowSec(),
    );
    await connectors.recordCheck(connId, true, null, nowSec());
    await expect(controller.update(srcId, { enabled: true })).resolves.toEqual({ ok: true });
    expect((await sources.getSource(srcId))!.enabled).toBe(true);
  });
});
