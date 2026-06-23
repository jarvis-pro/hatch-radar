import * as Crypto from 'expo-crypto';
import {
  emptyTriage,
  rowToTriage,
  type SyncOp,
  type SyncOpPayloads,
  type SyncOpType,
  type SyncOperation,
  type Triage,
  type TriageRow,
  type TriageStatus,
} from '@hatch-radar/shared';
import { getDb } from './schema';
import { appendOutbox } from './outbox';

/** 读取洞察的研判视图；从未研判过时返回默认值（status=pending） */
export function getTriage(insightId: number): Triage {
  const row = getDb().getFirstSync<TriageRow>(`SELECT * FROM triage WHERE insight_id = ?`, [
    insightId,
  ]);

  return row ? rowToTriage(row) : emptyTriage(insightId);
}

/** 按操作类型把变更落到 triage 表（updated_at 取操作发生时间） */
function applyLocal(op: SyncOperation): void {
  const db = getDb();
  switch (op.type) {
    case 'set_status':
      db.runSync(
        `INSERT INTO triage (insight_id, status, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
        [op.targetId, op.payload.status, op.createdAt],
      );
      break;
    case 'set_rating':
      db.runSync(
        `INSERT INTO triage (insight_id, rating, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
        [op.targetId, op.payload.rating, op.createdAt],
      );
      break;
    case 'set_tags':
      db.runSync(
        `INSERT INTO triage (insight_id, tags, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET tags = excluded.tags, updated_at = excluded.updated_at`,
        [op.targetId, JSON.stringify(op.payload.tags), op.createdAt],
      );
      break;
    case 'set_note':
      db.runSync(
        `INSERT INTO triage (insight_id, note, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
        [op.targetId, op.payload.note, op.createdAt],
      );
      break;
  }
}

/**
 * 记录一次研判操作：本地先行（写 triage）+ 向 outbox 追加操作日志，同一事务保证两表一致。
 * opId 为客户端生成的 UUID，服务端据此幂等去重（规格 §D）。
 */
function record<T extends SyncOpType>(type: T, targetId: number, payload: SyncOpPayloads[T]): void {
  const op = {
    opId: Crypto.randomUUID(),
    type,
    targetId,
    payload,
    createdAt: Math.floor(Date.now() / 1000),
  } satisfies SyncOp<T> as SyncOperation;
  getDb().withTransactionSync(() => {
    applyLocal(op);
    appendOutbox(op);
  });
}

/** 修改研判状态 */
export function setStatus(insightId: number, status: TriageStatus): void {
  record('set_status', insightId, { status });
}

/** 评级 1-5；传 null 清除评级 */
export function setRating(insightId: number, rating: number | null): void {
  record('set_rating', insightId, { rating });
}

/** 整体覆盖研判标签（替换语义，重放天然幂等） */
export function setTags(insightId: number, tags: string[]): void {
  record('set_tags', insightId, { tags });
}

/** 覆盖研判笔记；空字符串表示清空 */
export function setNote(insightId: number, note: string): void {
  record('set_note', insightId, { note });
}
