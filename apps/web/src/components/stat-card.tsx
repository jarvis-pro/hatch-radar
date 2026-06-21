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
  /** 迷你火花线数据（如每日洞察序列）；末位高亮为品牌色 */
  spark?: number[];
  /** 预留卡：虚线弱化 + 弱化数值（功能即将上线的占位） */
  reserved?: boolean;
  className?: string;
}

/** 迷你火花线：等宽细柱，按最大值归一，末位品牌高亮。 */
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const last = data.length - 1;
  return (
    <div className="mt-2 flex h-7 items-end gap-px" aria-hidden>
      {data.map((v, i) => (
        <div
          key={i}
          className={cn('flex-1 rounded-[1px]', i === last ? 'bg-primary' : 'bg-primary/30')}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * KPI 指标卡（看板 / 列表统计共用）：大写标签 + 等宽大数字 + 可选图标/辅助/火花线。
 * `reserved` 渲染为虚线弱化的占位卡（功能即将上线）。
 * 统一了原先分散在 dashboard / insights 的两套写法。
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  spark,
  reserved,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4',
        reserved && 'border-dashed bg-muted/20',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className="size-4 text-muted-foreground/50" /> : null}
      </div>
      <div
        className={cn(
          'mt-2 font-mono text-2xl font-semibold tabular-nums',
          reserved && 'text-muted-foreground',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
      {spark && spark.length > 0 ? <Sparkline data={spark} /> : null}
    </div>
  );
}
