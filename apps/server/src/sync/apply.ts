import { z } from 'zod';
import {
  TRIAGE_STATUSES,
  type SyncOpResult,
  type SyncOperation,
  type SyncPushResponse,
} from '@hatch-radar/shared';
import { getDb } from '../db/schema';
import { nowSec } from '../db/utils';
import { logger } from '../logger';

/**
 * 移动端推送的同步操作应用器（规格 §D）。
 *
 * 幂等保证：op_id 应用成功即写入 sync_ops；重复推送命中 op_id 返回 duplicate
 * 而不重复应用（对 App 同样视为成功）。整批在单个事务内处理，逐条得出结论，
 * rejected 不影响其余操作。
 */

/** 请求信封：deviceId + 待应用操作数组（单条操作的合法性在逐条校验时判定） */
export const pushEnvelopeSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  ops: z.array(z.unknown()).max(10_000),
});

/** 单条操作的协议校验（与 shared 的 SyncOpPayloads 一一对应） */
const opSchema = z.discriminatedUnion('type', [
  z.object({
    opId: z.string().trim().min(1).max(64),
    type: z.literal('set_status'),
    targetId: z.number().int().positive(),
    payload: z.object({ status: z.enum(TRIAGE_STATUSES) }),
    createdAt: z.number().int().positive(),
  }),
  z.object({
    opId: z.string().trim().min(1).max(64),
    type: z.literal('set_rating'),
    targetId: z.number().int().positive(),
    payload: z.object({ rating: z.number().int().min(1).max(5).nullable() }),
    createdAt: z.number().int().positive(),
  }),
  z.object({
    opId: z.string().trim().min(1).max(64),
    type: z.literal('set_tags'),
    targetId: z.number().int().positive(),
    payload: z.object({ tags: z.array(z.string().trim().min(1).max(64)).max(50) }),
    createdAt: z.number().int().positive(),
  }),
  z.object({
    opId: z.string().trim().min(1).max(64),
    type: z.literal('set_note'),
    targetId: z.number().int().positive(),
    payload: z.object({ note: z.string().max(10_000) }),
    createdAt: z.number().int().positive(),
  }),
]);

/** 尽力从非法操作中提取 opId，保证 results 与请求逐条对应 */
function extractOpId(raw: unknown, index: number): string {
  if (raw && typeof raw === 'object' && 'opId' in raw) {
    const opId = (raw as { opId: unknown }).opId;
    if (typeof opId === 'string' && opId.length > 0) return opId;
  }
  return `<无效操作 #${index}>`;
}

/** 按操作类型把变更落到服务端 triage 表（updated_at 取操作在设备上的发生时间） */
function applyTriageOp(op: SyncOperation): void {
  const db = getDb();
  switch (op.type) {
    case 'set_status':
      db.prepare(
        `INSERT INTO triage (insight_id, status, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      ).run(op.targetId, op.payload.status, op.createdAt);
      break;
    case 'set_rating':
      db.prepare(
        `INSERT INTO triage (insight_id, rating, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      ).run(op.targetId, op.payload.rating, op.createdAt);
      break;
    case 'set_tags':
      db.prepare(
        `INSERT INTO triage (insight_id, tags, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET tags = excluded.tags, updated_at = excluded.updated_at`,
      ).run(op.targetId, JSON.stringify(op.payload.tags), op.createdAt);
      break;
    case 'set_note':
      db.prepare(
        `INSERT INTO triage (insight_id, note, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
      ).run(op.targetId, op.payload.note, op.createdAt);
      break;
  }
}

/** 单条操作的处理：协议校验 → op_id 去重 → 目标存在性 → 应用 + 留痕 */
function applyOne(deviceId: string, raw: unknown, index: number): SyncOpResult {
  const parsed = opSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      opId: extractOpId(raw, index),
      outcome: 'rejected',
      reason: `payload 非法: ${issue.path.join('.')} ${issue.message}`,
    };
  }
  const op = parsed.data as SyncOperation;
  const db = getDb();

  if (db.prepare(`SELECT 1 FROM sync_ops WHERE op_id = ?`).get(op.opId)) {
    return { opId: op.opId, outcome: 'duplicate' };
  }
  if (!db.prepare(`SELECT 1 FROM insights WHERE id = ?`).get(op.targetId)) {
    return { opId: op.opId, outcome: 'rejected', reason: `目标洞察不存在: ${op.targetId}` };
  }

  applyTriageOp(op);
  db.prepare(
    `INSERT INTO sync_ops (op_id, device_id, type, target_id, payload, created_at, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    op.opId,
    deviceId,
    op.type,
    op.targetId,
    JSON.stringify(op.payload),
    op.createdAt,
    nowSec(),
  );
  return { opId: op.opId, outcome: 'applied' };
}

/**
 * 应用一批移动端同步操作（按请求内顺序逐条处理，整批一个事务）。
 * @param deviceId 推送设备标识（审计用）
 * @param rawOps 未经校验的操作数组（来自请求体）
 */
export function applySyncPush(deviceId: string, rawOps: unknown[]): SyncPushResponse {
  const db = getDb();
  const results: SyncOpResult[] = [];
  db.transaction(() => {
    rawOps.forEach((raw, index) => {
      results.push(applyOne(deviceId, raw, index));
    });
  })();

  const tally = { applied: 0, duplicate: 0, rejected: 0 };
  for (const r of results) tally[r.outcome]++;
  logger.info(
    `[同步] 设备 ${deviceId.slice(0, 8)}… 推送 ${rawOps.length} 条：应用 ${tally.applied} / 重复 ${tally.duplicate} / 拒绝 ${tally.rejected}`,
  );
  return { results };
}
