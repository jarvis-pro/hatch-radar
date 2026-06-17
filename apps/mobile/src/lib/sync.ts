import * as Crypto from 'expo-crypto';
import type { SyncPushRequest, SyncPushResponse } from '@hatch-radar/shared';
import { getMeta, setMeta } from '../db/schema';
import { countPending, listPending, markSynced, rowToOp } from '../db/outbox';
import { postJson, type WorkstationConfig } from './workstation';

/** 设备标识：首次访问时生成 UUID 并持久化（服务端审计与多设备区分用） */
export function getDeviceId(): string {
  const existing = getMeta('device_id');
  if (existing) return existing;
  const deviceId = Crypto.randomUUID();
  setMeta('device_id', deviceId);
  return deviceId;
}

/** 一次推送的结果汇总 */
export interface PushSummary {
  total: number;
  applied: number;
  duplicate: number;
  rejected: number;
  /** 被拒操作明细（opId + 原因），供界面完整展示而非只首条 */
  rejections: { opId: string; reason?: string }[];
}

/**
 * 把 outbox 中未同步的操作按发生顺序推送到工作台（规格 §D 同步流程的 push 步骤）。
 *
 * - applied / duplicate：服务端已生效（duplicate = 此前推送过，幂等跳过），本地标记 synced
 * - rejected：服务端无法应用（payload 非法 / 目标不存在），重试也不会成功——同样标记
 *   synced 防止死循环重发；操作日志保留在 outbox 表可追溯，原因计入返回值供界面展示
 */
export async function pushOutbox(cfg: WorkstationConfig): Promise<PushSummary> {
  const pending = listPending();
  if (pending.length === 0) {
    return { total: 0, applied: 0, duplicate: 0, rejected: 0, rejections: [] };
  }
  const body: SyncPushRequest = { deviceId: getDeviceId(), ops: pending.map(rowToOp) };
  const resp = await postJson<SyncPushResponse>(cfg, '/api/sync/push', body);

  const summary: PushSummary = {
    total: pending.length,
    applied: 0,
    duplicate: 0,
    rejected: 0,
    rejections: [],
  };
  for (const result of resp.results) {
    summary[result.outcome]++;
    if (result.outcome === 'rejected') {
      summary.rejections.push({ opId: result.opId, reason: result.reason });
    }
  }
  markSynced(resp.results.map((r) => r.opId));
  return summary;
}

/** 待同步条数（首页横幅与同步页用） */
export function pendingSyncCount(): number {
  return countPending();
}
