import { Badge } from '@hatch-radar/ui/components/badge';
import { Checkbox } from '@hatch-radar/ui/components/checkbox';

/** AnalyzeRow 组件 props */
export interface AnalyzeRowProps {
  /** 帖子标题 */
  title: string;
  /** 频道展示名（如 r/SaaS） */
  channel: string;
  /** pending=未分析；restale=已分析但评论又变（建议重判） */
  kind: 'pending' | 'restale';
  /** 多选是否选中 */
  selected: boolean;
  /** 切换选中 */
  onToggle: () => void;
}

/**
 * 单条待分析帖子：多选勾选 + 标题/频道/状态展示。
 * 运行与队列由 AnalyzeWorkbench 统一处理（模型直接串联，不再人工复制/粘贴）。
 */
export function AnalyzeRow({ title, channel, kind, selected, onToggle }: AnalyzeRowProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggle()}
        aria-label="选择此帖以运行分析"
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium">{title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{channel}</span>
          {kind === 'restale' ? <Badge variant="secondary">评论已更新 · 建议重判</Badge> : null}
        </div>
      </div>
    </label>
  );
}
