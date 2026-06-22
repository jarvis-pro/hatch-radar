import { Injectable } from '@nestjs/common';
import { AnalysisConfigService } from '../analysis/analysis-config.service';
import { AnalysisService } from '../analysis/analysis.service';
import { buildContext, normalizeInsight, parseLooseJson, SYSTEM_PROMPT } from '@/lib/analysis';
import { CommentsRepository, PostsRepository, type PostRow } from '@/database';
import type {
  AiCallOutput,
  ContextOutput,
  FetchOutput,
  InspectStepName,
  NormalizeOutput,
  PersistOutput,
} from '@hatch-radar/shared';
import { stepOutput, type StageLike } from './stage-usage';

/** 粗略估算每 token 字符数（仅用于检视展示，不参与计费） */
const EST_CHARS_PER_TOKEN = 4;

/**
 * 分析执行器（worker 侧）：承载 analyze 任务的**逐节点**执行（检视器 6 节点），每节点产物落 task_stages.output 做检查点。
 *
 * 节点拆分（与 docs/pipeline-inspector-design.md §三 一致）：
 * resolve（解析模型配置）→ fetch（拉原始数据规模）→ context（构建并落库完整上下文）→
 * ai_call（调 AI 拿原始响应，唯一不可重算节点）→ normalize（归一化）→ persist（按 post_id 幂等落库）。
 *
 * 每节点输入从 task / 重新拉取（幂等）/ 上游 output 检查点取。供 {@link WorkerService.execStage} 的
 * `case 'analyze'` 复用；「等待」语义（闸门置 paused 后重认领续跑）由 WorkerService 的通用任务内核负责，本执行器始终无状态。
 */
@Injectable()
export class AnalyzeExecutor {
  constructor(
    private readonly analysisConfig: AnalysisConfigService,
    private readonly analysis: AnalysisService,
    private readonly comments: CommentsRepository,
    private readonly posts: PostsRepository,
  ) {}

  /**
   * 按节点名执行单个流水线节点，返回其产物（落 task_stages.output）。
   * 输入按 docs/pipeline-inspector-design.md §三 表，从 task / 重新拉取（幂等）/ 上游 output 检查点取。
   */
  runNode(
    name: string,
    providerId: number | null,
    model: string,
    post: PostRow,
    stages: StageLike[],
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (name as InspectStepName) {
      case 'resolve':
        return this.nodeResolve(providerId);
      case 'fetch':
        return this.nodeFetch(post);
      case 'context':
        return this.nodeContext(post);
      case 'ai_call':
        return this.nodeAiCall(providerId, stages, signal);
      case 'normalize':
        return Promise.resolve(this.nodeNormalize(stages));
      case 'persist':
        return this.nodePersist(model, post, stages);
      default:
        return Promise.reject(new Error(`未知检视节点: ${name}`));
    }
  }

  /** 节点 0 resolve：解析模型配置（幂等）。 */
  private async nodeResolve(providerId: number | null) {
    if (providerId == null) throw new Error('任务未绑定模型（provider_id 为空）');
    const info = await this.analysisConfig.getProviderInspectInfo(providerId);
    if (!info) throw new Error('模型配置不存在或已停用');
    return info;
  }

  /** 节点 1 fetch：拉取原始数据规模（幂等）。 */
  private async nodeFetch(post: PostRow): Promise<FetchOutput> {
    const comments = await this.comments.getCommentsForPost(post.id);
    const maxDepth = comments.reduce((m, c) => Math.max(m, c.depth), 0);
    return {
      title: post.title,
      selftextChars: post.selftext.length,
      commentCount: comments.length,
      numComments: post.num_comments,
      maxDepth,
    };
  }

  /** 节点 2 context：构建并落库完整上下文（检查点——避免两次认领间评论改写导致「所见≠所跑」）。 */
  private async nodeContext(post: PostRow): Promise<ContextOutput> {
    const comments = await this.comments.getCommentsForPost(post.id);
    const contextText = buildContext(post, comments);
    return {
      systemPrompt: SYSTEM_PROMPT,
      contextText,
      chars: contextText.length,
      estimatedTokens: Math.ceil(contextText.length / EST_CHARS_PER_TOKEN),
    };
  }

  /** 节点 3 ai_call：读 context 检查点 + 解析处理器 → 调 AI 拿原始响应（不可重算，整设计落检查点的根因）。 */
  private async nodeAiCall(
    providerId: number | null,
    stages: StageLike[],
    signal: AbortSignal,
  ): Promise<AiCallOutput> {
    if (providerId == null) throw new Error('任务未绑定模型（provider_id 为空）');
    const ctx = stepOutput<ContextOutput>(stages, 'context');
    if (!ctx?.contextText) throw new Error('上游 context 节点产物缺失，无法调用 AI');
    const processor = await this.analysisConfig.getProcessorForProvider(providerId);
    if (!processor) throw new Error('模型配置不存在或已停用');
    const raw = await processor.callRaw(ctx.contextText, signal);
    return {
      raw: raw.raw,
      usage: raw.usage,
      keyId: raw.keyId ?? null,
      keySwitched: raw.keySwitched ?? false,
    };
  }

  /** 节点 4 normalize：读 ai_call 检查点 → 归一化（纯函数）+ 统计归一化丢弃的非法条目。 */
  private nodeNormalize(stages: StageLike[]): NormalizeOutput {
    const ai = stepOutput<AiCallOutput>(stages, 'ai_call');
    if (ai?.raw == null) throw new Error('上游 ai_call 节点产物缺失，无法归一化');
    const parsed = typeof ai.raw === 'string' ? parseLooseJson(ai.raw) : ai.raw;
    const insight = normalizeInsight(parsed);
    const p = parsed as { pain_points?: unknown[]; opportunities?: unknown[] };
    const rawPain = Array.isArray(p?.pain_points) ? p.pain_points.length : 0;
    const rawOpp = Array.isArray(p?.opportunities) ? p.opportunities.length : 0;
    return {
      insight,
      droppedPainPoints: Math.max(0, rawPain - insight.pain_points.length),
      droppedOpportunities: Math.max(0, rawOpp - insight.opportunities.length),
    };
  }

  /** 节点 5 persist：读 normalize 检查点 → 落库（saveInsight 按 post_id 幂等，重认领重跑安全）。 */
  private async nodePersist(
    model: string,
    post: PostRow,
    stages: StageLike[],
  ): Promise<PersistOutput> {
    const norm = stepOutput<NormalizeOutput>(stages, 'normalize');
    if (!norm?.insight) throw new Error('上游 normalize 节点产物缺失，无法落库');
    const { saved } = await this.analysis.persistInsight(post, model, norm.insight);
    return {
      saved,
      painPointCount: norm.insight.pain_points.length,
      opportunityCount: norm.insight.opportunities.length,
    };
  }
}
