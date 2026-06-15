import type { CommentRow, PostRow } from '@hatch-radar/shared';
import { InsightsRepository } from '@hatch-radar/db';
import { nowSec } from '@hatch-radar/kernel';
import { logger } from '@hatch-radar/kernel';
import type { PostProcessor } from '../analyzer/analyze';

/**
 * 「分析并落库」的编排服务：由 worker 处理单条 analysis job 时调用。
 *
 * 处理器只产出结构化结果；此处负责「无信号则不落库」的判定、saveInsight 与日志，
 * 把唯一的写入路径收敛在一处。
 */
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
  ): Promise<{ saved: boolean }> {
    const insight = await processor.analyze(post, comments, signal);
    if (insight.pain_points.length === 0 && insight.opportunities.length === 0) {
      return { saved: false };
    }
    await this.insights.saveInsight(post, processor.model, insight, nowSec());
    logger.info(
      `  ✓ r/${post.subreddit}「${post.title.slice(0, 48)}」→ 痛点 ${insight.pain_points.length} / 机会 ${insight.opportunities.length}`,
    );
    return { saved: true };
  }
}
