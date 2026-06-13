/**
 * 一次性数据迁移：旧 SQLite 主库（radar.db）→ PostgreSQL。
 *
 * 用法：
 *   DATABASE_URL=postgres://… node --import @swc-node/register/esm-register \
 *     scripts/migrate-sqlite-to-pg.ts [sqlite路径，默认 ./data/radar.db]
 *
 * 转换：JSON TEXT → jsonb（解析后写入）；enabled 0/1 → boolean；时间戳整数原样；
 * 保留 insights / model_providers 的自增 id（identity BY DEFAULT 允许显式写入，迁后重置序列）。
 * analysis_jobs 不搬（瞬态队列，空库起步）。迁移前先 TRUNCATE 目标库（可重复执行）。
 */
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  appSettings,
  comments,
  createDb,
  insights,
  modelProviders,
  posts,
  syncOps,
  triage,
} from '@hatch-radar/db';

const SQLITE_PATH = resolve(process.argv[2] ?? './data/radar.db');
const PG_URL =
  process.env.DATABASE_URL?.trim() || 'postgres://radar:radar@localhost:5432/hatch_radar';
const CHUNK = 500;

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function main(): Promise<void> {
  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const { db, close } = createDb(PG_URL);
  console.log(`迁移 ${SQLITE_PATH} → ${new URL(PG_URL).host}${new URL(PG_URL).pathname}`);

  const all = (table: string): Row[] => sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[];

  // 转换各表行（SQLite → PG 插入形状）
  const postRows = all('posts');
  const commentRows = all('comments');
  const insightRows = all('insights').map((r) => ({
    id: r.id as number,
    post_id: r.post_id as string,
    source: r.source as string,
    subreddit: r.subreddit as string,
    post_title: r.post_title as string,
    permalink: (r.permalink as string | null) ?? null,
    model: r.model as string,
    intensity: r.intensity as 'HIGH' | 'MEDIUM' | 'LOW',
    pain_points: parseJson(r.pain_points, [] as unknown[]),
    opportunities: parseJson(r.opportunities, [] as unknown[]),
    tags: parseJson(r.tags, [] as string[]),
    created_at: r.created_at as number,
  }));
  const triageRows = all('triage').map((r) => ({
    insight_id: r.insight_id as number,
    status: r.status as 'pending' | 'shortlisted' | 'archived',
    rating: (r.rating as number | null) ?? null,
    tags: parseJson(r.tags, [] as string[]),
    note: r.note as string,
    updated_at: r.updated_at as number,
  }));
  const providerRows = all('model_providers').map((r) => ({
    id: r.id as number,
    provider: r.provider as 'anthropic' | 'openai' | 'deepseek',
    label: r.label as string,
    api_key: r.api_key as string,
    base_url: (r.base_url as string | null) ?? null,
    model: r.model as string,
    enabled: r.enabled === 1 || r.enabled === true,
    created_at: r.created_at as number,
    updated_at: r.updated_at as number,
  }));
  const settingRows = all('app_settings');
  const syncRows = all('sync_ops').map((r) => ({
    op_id: r.op_id as string,
    device_id: r.device_id as string,
    type: r.type as string,
    target_id: r.target_id as number,
    payload: parseJson(r.payload, {} as Record<string, unknown>),
    created_at: r.created_at as number,
    applied_at: r.applied_at as number,
  }));

  async function load(name: string, table: PgTable, rows: Row[]): Promise<void> {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(table).values(rows.slice(i, i + CHUNK) as never);
    }
    console.log(`  ✓ ${name}: ${rows.length} 行`);
  }

  // 清空目标库（可重复执行）
  await db.execute(
    sql`TRUNCATE posts, comments, insights, triage, sync_ops, model_providers, app_settings, analysis_jobs RESTART IDENTITY CASCADE`,
  );

  console.log('搬运:');
  await load('model_providers', modelProviders, providerRows);
  await load('app_settings', appSettings, settingRows);
  await load('posts', posts, postRows);
  await load('comments', comments, commentRows);
  await load('insights', insights, insightRows);
  await load('triage', triage, triageRows);
  await load('sync_ops', syncOps, syncRows);

  // 重置 identity 序列，使后续插入不与保留的 id 冲突
  if (insightRows.length > 0) {
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence('insights', 'id'), (SELECT MAX(id) FROM insights))`,
    );
  }
  if (providerRows.length > 0) {
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence('model_providers', 'id'), (SELECT MAX(id) FROM model_providers))`,
    );
  }

  // 校验：逐表行数比对
  console.log('校验（SQLite → PG 行数）:');
  const tables: [string, number][] = [
    ['posts', postRows.length],
    ['comments', commentRows.length],
    ['insights', insightRows.length],
    ['triage', triageRows.length],
    ['model_providers', providerRows.length],
    ['app_settings', settingRows.length],
    ['sync_ops', syncRows.length],
  ];
  let ok = true;
  for (const [t, expected] of tables) {
    const res = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)}` as SQL,
    );
    const got = Number((res.rows ?? (res as unknown as { n: number }[]))[0].n);
    const mark = got === expected ? '✓' : '✗';
    if (got !== expected) ok = false;
    console.log(`  ${mark} ${t}: ${expected} → ${got}`);
  }

  sqlite.close();
  await close();
  console.log(ok ? '迁移完成，行数一致。' : '迁移完成，但存在行数不一致，请检查！');
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`迁移失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
