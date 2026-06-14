import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { ExportFilter } from '@hatch-radar/shared';
import { AnalysisConfigService } from '../analysis/analysis-config.service';
import { AnalysisService } from '../analysis/analysis.service';
import { APP_ENV } from '../common/tokens';
import { nowSec } from '../common/time';
import type { AppEnv } from '../config/env';
import { InsightsRepository } from '../db/insights.repository';
import { ExportService } from '../export/export.service';
import { defaultExportName, writeBatchJson, writeBatchSqlite } from '../export/sqlite-writer';
import { logger } from '../logger';
import { CliModule } from './cli.module';

const USAGE = `hatch-radar CLI

用法:
  pnpm cli <命令> [选项]

命令:
  insights    检索已落库的洞察（-s 版块 / -t 标签 / -i 强度 / -n 条数 / --json）
  analyze     手动触发一轮 AI 分析（用当前 active 模型）
  export      导出有效数据批次（-f sqlite|json / -o 路径 / --since / --days / -i / -s / -n）
  help        显示本帮助`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** insights：检索并打印洞察 */
async function runInsights(app: INestApplicationContext, args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      subreddit: { type: 'string', short: 's' },
      tag: { type: 'string', short: 't' },
      intensity: { type: 'string', short: 'i' },
      limit: { type: 'string', short: 'n', default: '20' },
      json: { type: 'boolean', default: false },
    },
  });
  const intensity = values.intensity?.toUpperCase();
  if (intensity && !['HIGH', 'MEDIUM', 'LOW'].includes(intensity)) {
    fail(`无效的强度等级: ${values.intensity}（可选 HIGH / MEDIUM / LOW）`);
  }
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit <= 0) fail(`无效的 limit: ${values.limit}`);

  const insights = await app.get(InsightsRepository).searchInsights({
    subreddit: values.subreddit,
    tag: values.tag,
    intensity,
    limit,
  });

  if (values.json) {
    console.log(JSON.stringify(insights, null, 2));
    return;
  }
  if (insights.length === 0) {
    console.log(
      '没有符合条件的洞察。（服务需运行一段时间，待评论回捞与 AI 分析完成后才会产生结果）',
    );
    return;
  }
  for (const item of insights) {
    const date = new Date(item.createdAt * 1000).toISOString().slice(0, 16).replace('T', ' ');
    const channel = item.source === 'reddit' ? `r/${item.subreddit}` : item.subreddit;
    console.log(`\n#${item.id} [${item.intensity}] ${channel} · ${date}`);
    console.log(`  ${item.postTitle}`);
    if (item.permalink) {
      const url = item.permalink.startsWith('http')
        ? item.permalink
        : `https://reddit.com${item.permalink}`;
      console.log(`  ${url}`);
    }
    if (item.tags.length > 0) console.log(`  标签: ${item.tags.join(' / ')}`);
    for (const pain of item.painPoints) {
      console.log(`  ▸ 痛点[${pain.intensity}] ${pain.description}`);
      if (pain.evidence) console.log(`      “${pain.evidence.slice(0, 120)}”`);
    }
    for (const opp of item.opportunities) {
      console.log(`  ★ 机会: ${opp.title} — ${opp.description}`);
      if (opp.target_user) console.log(`      目标用户: ${opp.target_user}`);
    }
  }
  console.log(`\n共 ${insights.length} 条洞察`);
}

/** analyze：用当前 active 模型手动跑一轮分析 */
async function runAnalyze(app: INestApplicationContext): Promise<void> {
  const analysisConfig = app.get(AnalysisConfigService);
  const active = await analysisConfig.getActiveProvider();
  if (!active) {
    fail('未配置 active 模型：请在 web 设置页配置并选用，或设 env AI_PROVIDER + KEY 作启动兜底');
  }
  const processor = await analysisConfig.getProcessorForProvider(active.id);
  if (!processor) fail('无法构建模型处理器（密钥解密失败或模型已停用），请检查设置');
  const env = app.get<AppEnv>(APP_ENV);
  logger.info(`手动分析一轮（${processor.label}）——内联跑批、绕过队列，勿与运行中的 worker 并发`);
  const stats = await app.get(AnalysisService).runBatch(processor, env.analyzeBatchSize);
  logger.info(
    `完成：处理 ${stats.analyzed} 篇，产出洞察 ${stats.saved} 条，失败 ${stats.failed} 篇`,
  );
}

/** export：导出有效数据批次为 .sqlite / .json */
async function runExport(app: INestApplicationContext, args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      format: { type: 'string', short: 'f', default: 'sqlite' },
      out: { type: 'string', short: 'o' },
      since: { type: 'string' },
      days: { type: 'string' },
      intensity: { type: 'string', short: 'i' },
      subreddit: { type: 'string', short: 's' },
      limit: { type: 'string', short: 'n' },
    },
  });
  const format = values.format;
  if (format !== 'sqlite' && format !== 'json') {
    fail(`无效的格式: ${values.format}（可选 sqlite / json）`);
  }
  const filter: ExportFilter = {};
  if (values.since !== undefined) {
    const since = Number(values.since);
    if (!Number.isInteger(since) || since <= 0) fail(`无效的 since: ${values.since}（需 Unix 秒）`);
    filter.since = since;
  } else if (values.days !== undefined) {
    const days = Number(values.days);
    if (!Number.isFinite(days) || days <= 0) fail(`无效的 days: ${values.days}`);
    filter.since = nowSec() - Math.round(days * 86400);
  }
  const intensity = values.intensity?.toUpperCase();
  if (intensity) {
    if (intensity !== 'HIGH' && intensity !== 'MEDIUM' && intensity !== 'LOW') {
      fail(`无效的强度等级: ${values.intensity}（可选 HIGH / MEDIUM / LOW）`);
    }
    filter.minIntensity = intensity;
  }
  if (values.subreddit) filter.subreddit = values.subreddit;
  if (values.limit !== undefined) {
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit <= 0) fail(`无效的 limit: ${values.limit}`);
    filter.limit = limit;
  }

  const batch = await app.get(ExportService).collectBatch(filter);
  const out = values.out ?? join('./data/exports', defaultExportName(format));
  const file = format === 'sqlite' ? writeBatchSqlite(batch, out) : writeBatchJson(batch, out);

  const { counts } = batch.meta;
  if (counts.insights === 0) {
    console.log('没有符合条件的有效数据（洞察需有实质信号；可放宽筛选条件重试）。');
  }
  console.log(`已导出: ${file}`);
  console.log(`  洞察 ${counts.insights} / 帖子 ${counts.posts} / 评论 ${counts.comments}`);
}

async function main(): Promise<void> {
  // pnpm 可能把 `pnpm cli -- insights` 的 `--` 原样传入，剥掉开头的分隔符
  const raw = process.argv.slice(2);
  while (raw[0] === '--') raw.shift();
  const command = raw[0];
  const rest = raw.slice(1);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  const app = await NestFactory.createApplicationContext(CliModule, { logger: false });
  try {
    switch (command) {
      case 'insights':
        await runInsights(app, rest);
        break;
      case 'analyze':
        await runAnalyze(app);
        break;
      case 'export':
        await runExport(app, rest);
        break;
      default:
        console.error(`未知命令: ${command}\n`);
        console.log(USAGE);
        process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(`CLI 失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
