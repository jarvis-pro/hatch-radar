/**
 * 一次性回填：用新的实体解码逻辑清洗**存量** HackerNews 帖子正文 / 评论，
 * 把残留的 `&#x2F;` 等未解 HTML 实体补解为对应字符。
 *
 * 背景：HN Firebase API 返回 HTML 转义文本，旧抓取实现只解少数命名实体，残留十六进制 / 数字实体
 * （如 `&#x2F;`）入库。新抓取已修复（packages/crawler/src/hackernews.ts decodeHtml）；但旧帖不会重抓，
 * 故对存量数据跑一次本脚本。
 *
 * 为什么仍要回填（即便已修新抓取）：
 * - **导出产物**（mobile sqlite/json）直接读库原文、不在导出层解码 → 历史 HN 文本会显示乱码链接；
 * - AI 重分析路径由 analysis 组 prompt 时再解码兜底（packages/analysis/.../context.ts decodeHtmlEntities），
 *   故 AI 不强依赖本回填，但回填后那层兜底对历史数据也变成无操作，数据在库内即干净。
 *
 * 安全要点：
 * - **只跑 decodeEntities（解实体），不跑 decodeHtml**：标签已在首抓时剥离，重跑会把正文里合法的
 *   `<...>`（由 `&lt;`/`&gt;` 解码而来）当标签误删。
 * - 仅作用于 HN 数据（posts.source='hackernews' / comments.id 以 `hn_` 前缀），不碰 Reddit（raw_json，未转义）。
 * - 只更新解码后**确有变化**的行；幂等，可重复执行。
 * - **默认 dry-run**，仅统计与抽样；加 `--apply` 才真正写库。
 *
 * 运行（在 apps/api 下）：
 *   pnpm backfill:hn-decode           # dry-run：报告将改动多少行 + 抽样 before/after
 *   pnpm backfill:hn-decode --apply   # 实际写库
 */
import { decodeEntities } from '@/lib/crawler';
import { createDb, type AppDatabase } from '@/lib/db';

/** 每批拉取 / 写入的行数（游标分页，避免一次性载入整表） */
const BATCH = 1000;
/** dry-run 打印的 before/after 抽样条数 */
const SAMPLE = 5;

interface Stats {
  scanned: number;
  changed: number;
  samples: Array<{ id: string; before: string; after: string }>;
}

/** 抽样展示用：压成单行并截断，避免刷屏 */
function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 100 ? `${oneLine.slice(0, 100)}…` : oneLine;
}

/** 回填 HN 帖子 selftext（按 source='hackernews' 圈定） */
async function backfillPosts(db: AppDatabase, apply: boolean): Promise<Stats> {
  const stats: Stats = { scanned: 0, changed: 0, samples: [] };
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.posts.findMany({
      where: { source: 'hackernews' },
      select: { id: true, selftext: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const updates = [];
    for (const row of rows) {
      stats.scanned++;
      const after = decodeEntities(row.selftext);
      if (after === row.selftext) continue;
      stats.changed++;
      if (stats.samples.length < SAMPLE) {
        stats.samples.push({ id: row.id, before: row.selftext, after });
      }
      if (apply)
        updates.push(db.posts.update({ where: { id: row.id }, data: { selftext: after } }));
    }
    if (updates.length > 0) await db.$transaction(updates);
  }
  return stats;
}

/** 回填 HN 评论 body（按 id 的 `hn_` 前缀圈定——评论表无 source 列，HN 评论 id 恒为 `hn_<num>`） */
async function backfillComments(db: AppDatabase, apply: boolean): Promise<Stats> {
  const stats: Stats = { scanned: 0, changed: 0, samples: [] };
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.comments.findMany({
      where: { id: { startsWith: 'hn_' } },
      select: { id: true, body: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const updates = [];
    for (const row of rows) {
      stats.scanned++;
      const after = decodeEntities(row.body);
      if (after === row.body) continue;
      stats.changed++;
      if (stats.samples.length < SAMPLE) {
        stats.samples.push({ id: row.id, before: row.body, after });
      }
      if (apply) updates.push(db.comments.update({ where: { id: row.id }, data: { body: after } }));
    }
    if (updates.length > 0) await db.$transaction(updates);
  }
  return stats;
}

function report(label: string, stats: Stats): void {
  console.log(`\n[${label}] 扫描 ${stats.scanned} 行，需解码 ${stats.changed} 行`);
  for (const s of stats.samples) {
    console.log(`  · ${s.id}`);
    console.log(`      旧: ${preview(s.before)}`);
    console.log(`      新: ${preview(s.after)}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('缺少 DATABASE_URL 环境变量（应由根 .env 提供）。');
    process.exit(1);
  }

  console.log(apply ? '== 回填 HN 实体解码（写库）==' : '== 回填 HN 实体解码（dry-run，不写库）==');
  const { db, close } = createDb(databaseUrl);
  try {
    const posts = await backfillPosts(db, apply);
    const comments = await backfillComments(db, apply);
    report('posts.selftext', posts);
    report('comments.body', comments);
    const total = posts.changed + comments.changed;
    if (apply) {
      console.log(`\n完成：已更新 ${total} 行。`);
    } else {
      console.log(`\nDry-run：将更新 ${total} 行。确认无误后加 --apply 实际写库。`);
    }
  } finally {
    await close();
  }
}

void main();
