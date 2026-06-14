import { Injectable } from '@nestjs/common';
import type { CommentRow, PostRow } from '@hatch-radar/shared';
import { CommentsRepository } from '@/db/comments.repository';
import { InsightsRepository } from '@/db/insights.repository';
import { PostsRepository } from '@/db/posts.repository';
import { nowSec } from '@/utils/time';
import { logger } from '@/logger';
import type { AnalysisStats, PostProcessor } from '@/analyzer/analyze';

/**
 * 「分析并落库」的编排服务：worker（单条 job）与 CLI（批处理）共用。
 *
 * 处理器只产出结构化结果；此处负责「无信号则不落库」的判定、saveInsight、计数与日志，
 * 把唯一的写入路径收敛在一处。
 */
@Injectable()
export class AnalysisService {
  constructor(
    private readonly posts: PostsRepository,
    private readonly comments: CommentsRepository,
    private readonly insights: InsightsRepository,
  ) {}

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

  /**
   * 取一批待分析帖子逐条交给处理器，处理失败不影响后续帖子（供 CLI `pnpm cli analyze` 用）。
   * - 失败时递增 analyze_attempts（达 3 次后不再重试），成功后标记为已分析
   * - **这是绕过 analysis_jobs 队列的内联路径，仅供 CLI 一次性 / 离线使用**：server 运行时
   *   请走队列（设置页选用 active / 调度自动入队），勿与常驻 worker 并发跑，否则可能重复处理同一帖。
   * @param processor 单篇处理器
   * @param batchSize 本批次最多处理的帖子数
   */
  async runBatch(processor: PostProcessor, batchSize: number): Promise<AnalysisStats> {
    const posts = await this.posts.getPostsToAnalyze(batchSize);
    const stats: AnalysisStats = { analyzed: 0, saved: 0, failed: 0 };
    if (posts.length === 0) return stats;

    logger.info(`本轮待处理帖子 ${posts.length} 篇（${processor.label}）`);
    for (const post of posts) {
      const comments = await this.comments.getCommentsForPost(post.id);
      try {
        const { saved } = await this.analyzeAndPersist(processor, post, comments);
        if (saved) stats.saved++;
        await this.posts.markAnalyzed(post.id, nowSec());
        stats.analyzed++;
      } catch (err) {
        stats.failed++;
        await this.posts.bumpAnalyzeAttempts(post.id);
        logger.error(
          `  ✗ 处理失败 ${post.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return stats;
  }
}
