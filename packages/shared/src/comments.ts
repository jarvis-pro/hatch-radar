/** comments 表的行结构 */
export interface CommentRow {
  id: string;
  /** 所属帖子 ID */
  post_id: string;
  /** 父评论 ID；顶层评论为 null */
  parent_id: string | null;
  /** 评论作者；账号已删除时为 null */
  author: string | null;
  body: string;
  /** 点赞数；HN 评论不暴露评分，恒为 0 */
  score: number;
  /** 评论深度：0 为顶层，1 为回复 */
  depth: number;
  /** 发评论 Unix 时间戳（秒） */
  created_utc: number;
  /** 本次回捞 Unix 时间戳（秒） */
  fetched_at: number;
}
