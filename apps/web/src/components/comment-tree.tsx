import { useState } from 'react';
import type { CommentRow } from '@hatch-radar/shared';
import { ArrowUp, ChevronRight } from 'lucide-react';
import { cn } from '@hatch-radar/ui/lib/utils';
import { commentAvatarDataUri } from '@/lib/avatar';
import { useTranslationView } from '@/translation/post-translation';
import { decodeEntities, timeAgo } from '@/lib/format';

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
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // 展示用时间倒序：每层兄弟按发布时间从新到旧，优先看最近评论（父→子嵌套结构保留）。
  // 仅影响 web 展示——AI 分析是独立路径（packages/analysis/.../context.ts，按得分排序），不受此影响。
  const sortByNewest = (nodes: CommentNode[]): void => {
    nodes.sort((a, b) => b.row.created_utc - a.row.created_utc);
    for (const n of nodes) {
      sortByNewest(n.children);
    }
  };
  sortByNewest(roots);
  return roots;
}

function CommentItem({ node }: { node: CommentNode }) {
  const { row, children } = node;
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = children.length > 0;
  const tr = useTranslationView();
  // 有中文译文且开启「显示中文」时显示译文，否则回退原文
  const body = (tr.showZh ? tr.get(row.body_hash) : undefined) ?? row.body;
  return (
    <li>
      {/* 头部：折叠键 + 头像字母 + 昵称（醒目）+ 次级元信息，与正文清晰分层 */}
      <div className="flex items-center gap-2">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? '展开回复' : '折叠回复'}
            className="-ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="inline-block size-4 shrink-0" aria-hidden />
        )}
        <img
          src={commentAvatarDataUri(row.author ?? '[deleted]')}
          alt=""
          aria-hidden
          className="size-5 shrink-0 rounded-full bg-muted"
        />
        <span className="truncate text-sm font-medium text-foreground">
          {row.author ?? '[已删除]'}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(row.created_utc)}</span>
        {row.score > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
            <ArrowUp className="size-3" />
            {row.score}
          </span>
        ) : null}
        {collapsed && hasChildren ? (
          <span className="shrink-0 text-xs text-muted-foreground">· {children.length} 条回复</span>
        ) : null}
      </div>
      {!collapsed ? (
        <p className="mt-1.5 ml-7 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
          {decodeEntities(body)}
        </p>
      ) : null}
      {hasChildren && !collapsed ? (
        <ul className="mt-3 ml-2.5 space-y-4 border-l pl-4">
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
    <ul className="space-y-4">
      {buildTree(comments).map((node) => (
        <CommentItem key={node.row.id} node={node} />
      ))}
    </ul>
  );
}
