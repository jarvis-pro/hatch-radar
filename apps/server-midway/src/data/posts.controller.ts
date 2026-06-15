import { Controller, Get, httpError, Inject, Param, Query, UseGuard } from '@midwayjs/core';
import type {
  AwaitingPost,
  CommentRow,
  FilterOptions,
  Insight,
  Paged,
  PostRow,
} from '@hatch-radar/shared';
import { parsePage, trimmed, type DataService } from '@hatch-radar/core';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { TOK } from '@/common/tokens';

/**
 * /api/posts/* —— 只读帖子 / 评论浏览（需 posts:view）。
 * `awaiting` 按需提升为 analyze:run（方法级覆盖类级能力闸）。
 * 路由声明顺序：filters / awaiting 字面量先于 :id（与 NestJS 版一致，须保持顺序）。
 */
@UseGuard(SessionAuthGuard)
@RequirePermission('posts:view')
@Controller('/posts')
export class PostsController {
  @Inject(TOK.data)
  data!: DataService;

  /** GET /api/posts —— 分页列表，筛选 source/subreddit/status/q/page */
  @Get('/')
  list(@Query() q: Record<string, string | undefined>): Promise<Paged<PostRow>> {
    const status = q.status === 'analyzed' || q.status === 'pending' ? q.status : undefined;
    return this.data.listPosts({
      source: trimmed(q.source),
      subreddit: trimmed(q.subreddit),
      status,
      q: trimmed(q.q),
      page: parsePage(q.page),
    });
  }

  /** GET /api/posts/filters —— 来源 / 版块去重清单 */
  @Get('/filters')
  filters(): Promise<FilterOptions> {
    return this.data.postFilterOptions();
  }

  /** GET /api/posts/awaiting —— 工作台待分析清单（需 analyze:run） */
  @Get('/awaiting')
  @RequirePermission('analyze:run')
  awaiting(@Query('page') page?: string): Promise<Paged<AwaitingPost>> {
    return this.data.listAwaitingManualResult(parsePage(page));
  }

  /** GET /api/posts/:id —— 单帖 + 其关联洞察（交叉跳转）；归档/不存在 404 */
  @Get('/:id')
  async detail(@Param('id') id: string): Promise<{ post: PostRow; insight: Insight | null }> {
    const post = await this.data.getPost(id);
    if (!post) throw new httpError.NotFoundError('帖子不存在或已归档');
    const insight = await this.data.getInsightForPost(id);
    return { post, insight };
  }

  /** GET /api/posts/:id/comments —— 帖子全部评论（升序，树由前端组装） */
  @Get('/:id/comments')
  comments(@Param('id') id: string): Promise<CommentRow[]> {
    return this.data.getComments(id);
  }
}
