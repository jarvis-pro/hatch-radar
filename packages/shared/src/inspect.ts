/**
 * 流水线检视器（Pipeline Inspector）跨端契约。
 *
 * 把「一条原始帖子如何一步步变成洞察」的 6 个节点显式建模：节点名 / 节点状态 / 各节点产物形状，
 * 以及 API 返回给 web 的检视任务视图。worker 是产物的生产者、web 是消费者，两端以本文件为单一事实源。
 * 设计见 docs/pipeline-inspector-design.md。
 */
import type { InsightResult } from './insights';

/**
 * 流水线 6 个节点（数组下标即 job_steps.seq 0..5，决定执行与展示顺序）：
 * resolve 解析模型 → fetch 拉取原始数据 → context 构建上下文 → ai_call 调用 AI →
 * normalize 解析归一化 → persist 落库。
 */
export const INSPECT_STEP_NAMES = [
  'resolve',
  'fetch',
  'context',
  'ai_call',
  'normalize',
  'persist',
] as const;

/** 节点名（应用层常量约束 job_steps.name，不建 DB enum 便于演进） */
export type InspectStepName = (typeof INSPECT_STEP_NAMES)[number];

/** 节点执行状态 */
export type InspectStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** 每个节点的中文展示名（web 流程图与面板标题用） */
export const INSPECT_STEP_LABELS: Record<InspectStepName, string> = {
  resolve: '解析模型',
  fetch: '拉取数据',
  context: '构建上下文',
  ai_call: '调用 AI',
  normalize: '解析归一化',
  persist: '落库',
};

// ─── 各节点产物形状（落 job_steps.output 的 jsonb，web 据此渲染对应面板）────────────────

/** resolve 产物：解析出的模型信息 */
export interface ResolveOutput {
  providerId: number;
  /** 模型展示名（model_providers.label） */
  label: string;
  /** 模型 ID 快照 */
  model: string;
  /** provider 类型：anthropic / openai / deepseek / claude_cli */
  providerKind: string;
  /** 可用 API Key 数（claude_cli 订阅模式为 0，无 Key 池） */
  usableKeyCount: number;
}

/** fetch 产物：拉取到的原始数据规模 */
export interface FetchOutput {
  title: string;
  /** 正文字符数 */
  selftextChars: number;
  /** 本地已抓评论总数 */
  commentCount: number;
  /** 来源标称评论数（可能多于本地已抓） */
  numComments: number;
  /** 评论楼层树最大深度（0 表示仅顶层 / 无评论） */
  maxDepth: number;
}

/** context 产物：构建好的完整上下文（检查点，下游 ai_call 从此读取） */
export interface ContextOutput {
  /** 系统 prompt 全文 */
  systemPrompt: string;
  /** buildContext 生成的完整上下文文本 */
  contextText: string;
  /** 上下文字符数 */
  chars: number;
  /** 估算 token 数（粗略：字符数 / 4） */
  estimatedTokens: number;
}

/** ai_call 产物：模型原始响应（检查点——不可重算，重跑 normalize 不再重调 AI） */
export interface AiCallOutput {
  /** 模型原始输出：anthropic/openai 为 JSON 文本；claude_cli 为 structured_output 对象 */
  raw: string | object;
  /** token 用量（某些 provider 不报告时为 null） */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  } | null;
  /** API Key 模式实际使用的 Key id（claude_cli 无 Key 为 null） */
  keyId: number | null;
  /** 是否发生过 Key 切换（多 Key 故障转移） */
  keySwitched: boolean;
}

/** normalize 产物：归一化后的结构化结果 + 丢弃统计 */
export interface NormalizeOutput {
  insight: InsightResult;
  /** 归一化丢弃的非法痛点条目数（缺 description） */
  droppedPainPoints: number;
  /** 归一化丢弃的非法机会条目数（缺 title） */
  droppedOpportunities: number;
}

/** persist 产物：落库结果 */
export interface PersistOutput {
  /** 是否有信号并落库（痛点/机会均空则 false，不落库） */
  saved: boolean;
  painPointCount: number;
  opportunityCount: number;
}

// ─── API 视图（GET /api/analysis/inspect/:jobId 返回，时间戳为 number）─────────────────

/** 单个节点的检视视图（job_steps 行，时间戳 number、output 已解析） */
export interface InspectStepView {
  seq: number;
  name: InspectStepName | string;
  status: InspectStepStatus | string;
  /** 输入摘要（展示用） */
  inputSummary: unknown | null;
  /** 节点产物（按 name 对应上面的 *Output 形状） */
  output: unknown | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/** 检视任务整体视图：任务元信息 + 6 个节点轨迹 */
export interface InspectJobView {
  id: number;
  postId: string;
  postTitle: string | null;
  model: string;
  /** provider 类型（已删则 null） */
  provider: string | null;
  /** 任务状态：queued / running / paused / succeeded / failed / canceled */
  status: string;
  /** 逐节点闸门是否开启 */
  stepGate: boolean;
  trigger: string;
  error: string | null;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  steps: InspectStepView[];
}
