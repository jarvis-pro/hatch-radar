import { parseArgs } from 'node:util';
import { searchInsights } from './db/queries.js';
import { getDb } from './db/schema.js';

const USAGE = `检索已落库的洞察结果

用法:
  pnpm insights [选项]

选项:
  -s, --subreddit <name>   按版块过滤（如 SaaS）
  -t, --tag <keyword>      按标签模糊匹配（如 效率）
  -i, --intensity <level>  按强度过滤: HIGH / MEDIUM / LOW
  -n, --limit <count>      返回条数，默认 20
      --json               以 JSON 输出
  -h, --help               显示帮助

示例:
  pnpm insights --subreddit SaaS --intensity HIGH
  pnpm insights --tag 效率 --limit 5 --json`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// pnpm 会把 `pnpm insights -- --tag x` 中的 `--` 原样传入，剥掉开头的分隔符
const rawArgs = process.argv.slice(2);
while (rawArgs[0] === '--') rawArgs.shift();

const { values } = parseArgs({
  args: rawArgs,
  allowPositionals: true,
  options: {
    subreddit: { type: 'string', short: 's' },
    tag: { type: 'string', short: 't' },
    intensity: { type: 'string', short: 'i' },
    limit: { type: 'string', short: 'n', default: '20' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const intensity = values.intensity?.toUpperCase();
if (intensity && !['HIGH', 'MEDIUM', 'LOW'].includes(intensity)) {
  fail(`无效的强度等级: ${values.intensity}（可选 HIGH / MEDIUM / LOW）`);
}
const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit <= 0) {
  fail(`无效的 limit: ${values.limit}`);
}

getDb();
const insights = searchInsights({
  subreddit: values.subreddit,
  tag: values.tag,
  intensity,
  limit,
});

if (values.json) {
  console.log(JSON.stringify(insights, null, 2));
  process.exit(0);
}

if (insights.length === 0) {
  console.log('没有符合条件的洞察。（服务需运行一段时间，待评论回捞与 AI 分析完成后才会产生结果）');
  process.exit(0);
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
