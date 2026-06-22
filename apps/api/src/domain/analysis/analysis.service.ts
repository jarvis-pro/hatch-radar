import { Injectable } from '@nestjs/common';
import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import { InsightsRepository } from '@/lib/db';
import { nowSec } from '@/lib/kernel';
import { logger } from '@/lib/kernel';
import type { PostProcessor, TokenUsage } from '@/lib/analysis/analyzer/analyze';

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
   * @param signal 可选中止信号（worker 传入 job 超时信号，使慢调用真正停下）
   * @returns saved 是否产出并落库了洞察
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
