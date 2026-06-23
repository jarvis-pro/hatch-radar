import type { OutboxRow, SyncOperation } from '@hatch-radar/shared';
import { getDb } from './schema';

/** 向 outbox 追加一条操作日志（由 triage.record 在事务内调用） */
export function appendOutbox(op: SyncOperation): void {
  getDb().runSync(
    `INSERT INTO outbox (op_id, type, target_id, payload, created_at, synced) VALUES (?, ?, ?, ?, ?, 0)`,
    [op.opId, op.type, op.targetId, JSON.stringify(op.payload), op.createdAt],
  );
}

/** 待同步操作条数（首页横幅与同步页展示用） */
export function countPending(): number {
  return (
    getDb().getFirstSync<{ n: number }>(`SELECT COUNT(*) n FROM outbox WHERE synced = 0`)?.n ?? 0
  );
}

/**
 * 取全部待同步操作，按发生时间升序（同秒内按插入顺序）。
 * 推送时按此顺序逐条应用，保证服务端看到的操作次序与设备上一致。
 */
export function listPending(): OutboxRow[] {
  return getDb().getAllSync<OutboxRow>(
    `SELECT op_id, type, target_id, payload, created_at, synced
     FROM outbox WHERE synced = 0 ORDER BY created_at ASC, rowid ASC`,
  );
}

/** outbox 行 → 同步协议操作对象（payload JSON 反序列化） */
export function rowToOp(row: OutboxRow): SyncOperation {
  return {
    opId: row.op_id,
    type: row.type,
    targetId: row.target_id,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  } as SyncOperation;
}

/** 把一批操作标记为已同步（applied / duplicate / rejected 均视为已处理，不再重发） */
export function markSynced(opIds: string[]): void {
  if (opIds.length === 0) {
    return;
  }
  const db = getDb();
  db.withTransactionSync(() => {
    for (const opId of opIds) {
      db.runSync(`UPDATE outbox SET synced = 1 WHERE op_id = ?`, [opId]);
    }
  });
}
