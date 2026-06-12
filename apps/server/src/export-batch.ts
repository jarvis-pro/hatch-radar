/**
 * `pnpm export:batch` 命令行入口：把「有效数据」批次导出为 .sqlite 或 .json 文件。
 *
 * 顶层脚本（无导出符号），import 即执行：解析参数 → 校验 → 收集批次 → 写文件。
 * 产物供 AirDrop 给手机后由移动端导入（规格 §A / §C）。
 */
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import type { ExportFilter } from '@hatch-radar/shared';
import { getDb, closeDb } from './db/schema';
import { nowSec } from './db/utils';
import {
  collectExportBatch,
  defaultExportName,
  writeBatchJson,
  writeBatchSqlite,
} from './export/batch';

/** `--help` 输出的用法说明文本。 */
const USAGE = `导出批次：筛选有效数据（有实质信号的洞察 + 关联帖子/评论）落地为文件

用法:
  pnpm export:batch [选项]

选项:
  -f, --format <fmt>       sqlite（默认）或 json
  -o, --out <file>         输出路径，默认 ./data/exports/batch-<时间戳>.<格式>
      --since <unixSec>    仅导出该时间戳之后生成的洞察（增量）
      --days <n>           仅导出近 n 天生成的洞察（与 --since 二选一，后者优先）
  -i, --intensity <level>  最低强度: HIGH / MEDIUM / LOW
  -s, --subreddit <name>   按版块过滤（如 SaaS）
  -n, --limit <count>      最多导出条数（按生成时间倒序截断）
  -h, --help               显示帮助

示例:
  pnpm export:batch                          # 全量有效数据 → .sqlite
  pnpm export:batch --days 7 -i MEDIUM       # 近 7 天中高强度
  pnpm export:batch -f json -o /tmp/b.json   # JSON 载体`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// pnpm 会把 `pnpm export:batch -- --days 7` 中的 `--` 原样传入，剥掉开头的分隔符
const rawArgs = process.argv.slice(2);
while (rawArgs[0] === '--') rawArgs.shift();

const { values } = parseArgs({
  args: rawArgs,
  allowPositionals: true,
  options: {
    format: { type: 'string', short: 'f', default: 'sqlite' },
    out: { type: 'string', short: 'o' },
    since: { type: 'string' },
    days: { type: 'string' },
    intensity: { type: 'string', short: 'i' },
    subreddit: { type: 'string', short: 's' },
    limit: { type: 'string', short: 'n' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

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

getDb();
const batch = collectExportBatch(filter);
const out = values.out ?? join('./data/exports', defaultExportName(format));
const file = format === 'sqlite' ? writeBatchSqlite(batch, out) : writeBatchJson(batch, out);
closeDb();

const { counts } = batch.meta;
if (counts.insights === 0) {
  console.log('没有符合条件的有效数据（洞察需有实质信号；可放宽筛选条件重试）。');
}
console.log(`已导出: ${file}`);
console.log(`  洞察 ${counts.insights} / 帖子 ${counts.posts} / 评论 ${counts.comments}`);
