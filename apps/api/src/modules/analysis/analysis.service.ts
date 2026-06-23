import { Injectable } from '@nestjs/common';
import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import { InsightsRepository } from '@/database';
import { nowSec } from '@/utils/time';
import { logger } from '@/logger';
import type { PostProcessor, TokenUsage } from '@/analysis/analyzer/analyze';

/**
 * 「分析并落库」的编排服务：由 worker 处理单条 analysis job 时调用。
 *
 * 处理器只产出结构化结果；此处负责「无信号则不落库」的判定、saveInsight 与日志，
 * 把唯一的写入路径收敛在一处。
 */
@Injectable()
export class AnalysisService {
  constructor(private readonly insights: InsightsRepository) {}

  /**
   * 分析单篇帖子并按需落库。
   * - pain_points 与 opportunities 均为空时视为无信号，不落库，saved 为 false
   * @param processor 帖子处理器（封装选定模型 + 多 Key 故障转移）
   * @param post 待分析帖子
   * @param comments 该帖评论（作为分析上下文）
   * @param signal 可选中止信号（worker 传入 job 超时信号，使慢调用真正停下）
   * @returns saved=是否产出并落库了洞察；usage=本次 AI 调用 token 用量（不可得时为 null）
   */
  async analyzeAndPersist(
    processor: PostProcessor,
    post: PostRow,
    comments: CommentRow[],
    signal?: AbortSignal,
  ): Promise<{ saved: boolean; usage: TokenUsage | null }> {
    const { insight, usage } = await processor.analyze(post, comments, signal);
    const { saved } = await this.persistInsight(post, processor.model, insight);

    return { saved, usage };
  }

  /**
   * 落库一条已归一化的洞察（无信号则不落库）。analyzeAndPersist 与流水线检视器 persist 节点共用——
   * 把「无信号判定 + saveInsight + 日志」收敛于一处。saveInsight 按 post_id 幂等（upsert），故
   * persist 节点重认领重跑安全。
   * @param post 来源帖子（提供落库的 source / subreddit / title / permalink）
   * @param model 分析所用模型名（落库快照）
   * @param insight 已归一化的洞察结果
   * @returns saved 是否产出并落库了洞察
   */
  async persistInsight(
    post: PostRow,
    model: string,
    insight: InsightResult,
  ): Promise<{ saved: boolean }> {
    if (insight.pain_points.length === 0 && insight.opportunities.length === 0) {
      return { saved: false };
    }

    await this.insights.saveInsight(post, model, insight, nowSec());
    logger.info(
      `  ✓ r/${post.subreddit}「${post.title.slice(0, 48)}」→ 痛点 ${insight.pain_points.length} / 机会 ${insight.opportunities.length}`,
    );

    return { saved: true };
  }
}
