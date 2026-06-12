import type { CommentRow } from '@hatch-radar/shared';
import { timeAgo } from '@/lib/format';

interface CommentNode {
  row: CommentRow;
  children: CommentNode[];
}

/**
 * 把按时间排序的评论平铺列表组装成树。
 * parent_id 缺失或指向未抓取评论时，该节点按顶层处理（容忍部分回捞）。
 */
function buildTree(rows: CommentRow[]): CommentNode[] {
  const byId = new Map<string, CommentNode>(rows.map((row) => [row.id, { row, children: [] }]));
  const roots: CommentNode[] = [];
  for (const node of byId.values()) {
    const parent = node.row.parent_id ? byId.get(node.row.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function CommentItem({ node }: { node: CommentNode }) {
  const { row, children } = node;
  return (
    <li className="comment">
      <div className="comment-meta">
        <span className="comment-author">{row.author ?? '[已删除]'}</span>
        {row.score > 0 ? <span>▲ {row.score}</span> : null}
        <time>{timeAgo(row.created_utc)}</time>
      </div>
      <p className="comment-body">{row.body}</p>
      {children.length > 0 ? (
        <ul className="comment-children">
          {children.map((child) => (
            <CommentItem key={child.row.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** 嵌套评论树（评论为空时渲染占位文案） */
export function CommentTree({ comments }: { comments: CommentRow[] }) {
  if (comments.length === 0) {
    return <p className="muted">暂无评论（评论在发帖 6h / 12h 后由 server 回捞）。</p>;
  }
  return (
    <ul className="comment-list">
      {buildTree(comments).map((node) => (
        <CommentItem key={node.row.id} node={node} />
      ))}
    </ul>
  );
}
