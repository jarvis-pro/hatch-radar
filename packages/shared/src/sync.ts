/**
 * App ⇄ 工作台 数据同步协议（docs/multiplatform-refactor-spec.md §D）。
 *
 * 本地优先：移动端每次变更先写本地业务表，同时向 outbox（操作日志表）追加一条记录；
 * 回到工作台局域网后由用户确认，把未同步操作按 createdAt 升序 POST 到工作台，
 * 服务端按 opId 去重、幂等应用。当前同步方向仅 App → 工作台。
 */

/**
 * 研判状态：移动端人工筛选洞察时的处理阶段。
 * 初始集合，离线研判 UI（里程碑 5）落地时可按需扩展。
 */
export type TriageStatus = 'pending' | 'shortlisted' | 'archived';

/** 各同步操作类型对应的 payload 结构 */
export interface SyncOpPayloads {
  /** 修改研判状态 */
  set_status: { status: TriageStatus };
  /** 评级 1-5；null 表示清除评级 */
  set_rating: { rating: number | null };
  /** 研判标签整体覆盖（替换语义，重放天然幂等） */
  set_tags: { tags: string[] };
  /** 覆盖研判笔记；空字符串表示清空 */
  set_note: { note: string };
}

/** 同步操作类型标识 */
export type SyncOpType = keyof SyncOpPayloads;

/** 一条同步操作日志；T 收窄后 payload 与 type 联动 */
export interface SyncOp<T extends SyncOpType = SyncOpType> {
  /** 客户端生成的 UUID，服务端据此去重实现幂等（重发不会重复应用） */
  opId: string;
  /** 操作类型 */
  type: T;
  /** 目标洞察 id（insights.id） */
  targetId: number;
  /** 操作内容，结构由 type 决定 */
  payload: SyncOpPayloads[T];
  /** 操作发生时间，Unix 秒 */
  createdAt: number;
}

/** 所有操作类型的可辨识联合，switch (op.type) 后 payload 自动收窄 */
export type SyncOperation = { [T in SyncOpType]: SyncOp<T> }[SyncOpType];

/** App → 工作台：批量推送 outbox 中未同步的操作（按 createdAt 升序） */
export interface SyncPushRequest {
  /** 设备标识（App 安装时生成的 UUID），用于服务端审计与多设备区分 */
  deviceId: string;
  /** 待应用的操作列表 */
  ops: SyncOperation[];
}

/** 单条操作的服务端处理结论 */
export type SyncOpOutcome =
  /** 本次成功应用 */
  | 'applied'
  /** opId 此前已应用过，幂等跳过（对 App 同样视为成功） */
  | 'duplicate'
  /** 无法应用（如目标洞察不存在、payload 非法） */
  | 'rejected';

/** 单条操作的应用结果 */
export interface SyncOpResult {
  opId: string;
  outcome: SyncOpOutcome;
  /** outcome=rejected 时的原因说明 */
  reason?: string;
}

/** 工作台 → App：推送处理结果；applied / duplicate 的操作应在本地标记 synced */
export interface SyncPushResponse {
  results: SyncOpResult[];
}

/**
 * 移动端本地 outbox 表的行结构（操作日志 + 同步状态）。
 * 与 SyncOperation 的字段一一对应，payload 以 JSON 字符串落库。
 */
export interface OutboxRow {
  op_id: string;
  type: SyncOpType;
  target_id: number;
  /** JSON.stringify 后的 payload */
  payload: string;
  created_at: number;
  /** 0=待同步 1=已同步 */
  synced: 0 | 1;
}
