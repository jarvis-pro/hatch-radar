import { useState } from 'react';
import type { CommentRow } from '@hatch-radar/shared';
import { ArrowUp, ChevronRight } from 'lucide-react';
import { cn } from '@hatch-radar/ui/lib/utils';
import { timeAgo } from '@/lib/format';

/** 评论树节点：包装一条评论及其按 parent_id 关联的子回复。 */
interface CommentNode {
  /** 当前评论数据 */
  row: CommentRow;
  /** 直接子回复（递归构成多层嵌套） */
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
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = children.length > 0;
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? '展开回复' : '折叠回复'}
            className="-ml-1 inline-flex size-4 items-center justify-center rounded hover:bg-accent hover:text-foreground"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
            />
          </button>
        ) : null}
        <span className="font-medium text-foreground">{row.author ?? '[已删除]'}</span>
        {row.score > 0 ? (
          <span className="inline-flex items-center gap-0.5 tabular-nums">
            <ArrowUp className="size-3" />
            {row.score}
          </span>
        ) : null}
        <time>{timeAgo(row.created_utc)}</time>
        {collapsed && hasChildren ? <span>· {children.length} 条回复已折叠</span> : null}
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap break-words">{row.body}</p>
      {hasChildren && !collapsed ? (
        <ul className="mt-3 space-y-3 border-l pl-4">
          {children.map((child) => (
            <CommentItem key={child.row.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** 嵌套评论树（评论为空时渲染占位文案；有子回复的节点可折叠）。 */
export function CommentTree({ comments }: { comments: CommentRow[] }) {
  if (comments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        暂无评论（评论在发帖 6h / 12h 后由 server 回捞）。
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {buildTree(comments).map((node) => (
        <CommentItem key={node.row.id} node={node} />
      ))}
    </ul>
  );
}
