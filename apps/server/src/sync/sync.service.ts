import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  TRIAGE_STATUSES,
  type SyncOpResult,
  type SyncOperation,
  type SyncPushResponse,
} from '@hatch-radar/shared';
import { Prisma, type AppDatabase } from '@hatch-radar/db';
import { PRISMA } from '../common/tokens';
import { nowSec } from '../common/time';

/** Prisma 交互式事务句柄类型 */
type Tx = Prisma.TransactionClient;

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

/**
 * 移动端推送的同步操作应用器（规格 §D）。
 *
 * 幂等保证：op_id 应用成功即写入 sync_ops；重复推送命中 op_id 返回 duplicate
 * 而不重复应用（对 App 同样视为成功）。整批在单个事务内处理，逐条得出结论，
 * rejected 不影响其余操作。
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /** 按操作类型把变更落到服务端 triage 表（updated_at 取操作在设备上的发生时间） */
  private async applyTriageOp(tx: Tx, op: SyncOperation): Promise<void> {
    const insight_id = op.targetId;
    const updated_at = BigInt(op.createdAt);
    switch (op.type) {
      case 'set_status':
        await tx.triage.upsert({
          where: { insight_id },
          create: { insight_id, status: op.payload.status, updated_at },
          update: { status: op.payload.status, updated_at },
        });
        break;
      case 'set_rating':
        await tx.triage.upsert({
          where: { insight_id },
          create: { insight_id, rating: op.payload.rating, updated_at },
          update: { rating: op.payload.rating, updated_at },
        });
        break;
      case 'set_tags':
        await tx.triage.upsert({
          where: { insight_id },
          create: { insight_id, tags: op.payload.tags, updated_at },
          update: { tags: op.payload.tags, updated_at },
        });
        break;
      case 'set_note':
        await tx.triage.upsert({
          where: { insight_id },
          create: { insight_id, note: op.payload.note, updated_at },
          update: { note: op.payload.note, updated_at },
        });
        break;
    }
  }

  /** 单条操作的处理：协议校验 → op_id 去重 → 目标存在性 → 应用 + 留痕 */
  private async applyOne(
    tx: Tx,
    deviceId: string,
    raw: unknown,
    index: number,
  ): Promise<SyncOpResult> {
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

    const dup = await tx.sync_ops.findUnique({
      where: { op_id: op.opId },
      select: { op_id: true },
    });
    if (dup) return { opId: op.opId, outcome: 'duplicate' };

    const target = await tx.insights.findUnique({
      where: { id: op.targetId },
      select: { id: true },
    });
    if (!target) {
      return { opId: op.opId, outcome: 'rejected', reason: `目标洞察不存在: ${op.targetId}` };
    }

    await this.applyTriageOp(tx, op);
    await tx.sync_ops.create({
      data: {
        op_id: op.opId,
        device_id: deviceId,
        type: op.type,
        target_id: op.targetId,
        payload: op.payload as unknown as Prisma.InputJsonValue,
        created_at: BigInt(op.createdAt),
        applied_at: BigInt(nowSec()),
      },
    });
    return { opId: op.opId, outcome: 'applied' };
  }

  /**
   * 应用一批移动端同步操作（按请求内顺序逐条处理，整批一个事务）。
   * @param deviceId 推送设备标识（审计用）
   * @param rawOps 未经校验的操作数组（来自请求体）
   */
  async applySyncPush(deviceId: string, rawOps: unknown[]): Promise<SyncPushResponse> {
    const results = await this.db.$transaction(async (tx) => {
      const acc: SyncOpResult[] = [];
      for (let i = 0; i < rawOps.length; i++) {
        acc.push(await this.applyOne(tx, deviceId, rawOps[i], i));
      }
      return acc;
    });

    const tally = { applied: 0, duplicate: 0, rejected: 0 };
    for (const r of results) tally[r.outcome]++;
    this.logger.log(
      `设备 ${deviceId.slice(0, 8)}… 推送 ${rawOps.length} 条：应用 ${tally.applied} / 重复 ${tally.duplicate} / 拒绝 ${tally.rejected}`,
    );
    return { results };
  }
}
