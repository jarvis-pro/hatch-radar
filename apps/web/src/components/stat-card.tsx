import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@hatch-radar/ui/lib/utils';

/** StatCard props */
interface StatCardProps {
  /** 指标名（小号大写标签） */
  label: string;
  /** 指标值（等宽数字，醒目） */
  value: ReactNode;
  /** 右上角图标 */
  icon?: LucideIcon;
  /** 值下方的辅助说明 / 趋势 */
  hint?: ReactNode;
  className?: string;
}

/**
 * KPI 指标卡（看板 / 列表统计共用）：大写标签 + 等宽大数字 + 可选图标/辅助。
 * 统一了原先分散在 dashboard / insights 的两套写法。
 */
export function StatCard({ label, value, icon: Icon, hint, className }: StatCardProps) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {Icon ? <Icon className="size-4 text-muted-foreground/50" /> : null}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
