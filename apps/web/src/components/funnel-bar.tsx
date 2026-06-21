import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@hatch-radar/ui/lib/utils';

/** 漏斗一阶（看板价值漏斗用）。 */
export interface FunnelStage {
  key: string;
  /** 阶段名（采集 / 分析 / 洞察 / 验证）。 */
  name: string;
  /** 右上角量纲标签（posts / analyzed / insights）。 */
  tag?: string;
  /** 计数；预留阶段（验证）无数据时为 null，显「—」。 */
  value: number | null;
  /** 相对首阶段（采集 = 100）的宽度百分比。 */
  pct: number;
  /** 配色基调：品牌 → 信号的渐降 + 预留虚线。 */
  tone: 'brand' | 'mid' | 'signal' | 'reserved';
  /** 到下一阶段的转化（标签 + 百分比文案），渲染为阶段间连接器。 */
  conv?: { label: string; value: string };
  /** 预留阶段说明（如「研判功能即将上线」）。 */
  note?: ReactNode;
}

/** tone → 填充条样式（品牌靛紫 → 信号青的渐降；预留为虚线弱化）。 */
const TONE: Record<FunnelStage['tone'], string> = {
  brand: 'bg-primary glow-primary',
  mid: 'bg-primary/70',
  signal: 'bg-signal',
  reserved: 'border-2 border-dashed border-border bg-muted/30',
};

/**
 * 价值漏斗（看板英雄区）：自上而下递减的横条，条宽 ∝ pct；阶段间以转化率连接，
 * 预留阶段（验证）虚线弱化 + 说明文案。纯 token 着色、无自定义 CSS。
 */
export function FunnelBar({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="space-y-1">
      {stages.map((s, i) => (
        <div key={s.key}>
          {/* 阶段头：名（+ 预留说明） + 量纲标签 */}
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {s.name}
              {s.note ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">{s.note}</span>
              ) : null}
            </span>
            {s.tag ? <span className="font-mono text-xs text-muted-foreground">{s.tag}</span> : null}
          </div>
          {/* 条 + 数值 */}
          <div className="flex items-center gap-3">
            <div className="h-10 flex-1 overflow-hidden rounded-lg bg-muted/40">
              <div
                className={cn('h-full rounded-lg transition-all', TONE[s.tone])}
                style={{ width: `${Math.max(4, Math.min(100, s.pct))}%` }}
              />
            </div>
            <div
              className={cn(
                'w-20 shrink-0 text-right font-mono text-xl font-semibold tabular-nums',
                s.tone === 'reserved' && 'text-muted-foreground',
              )}
            >
              {s.value == null ? '—' : s.value.toLocaleString()}
            </div>
          </div>
          {/* 阶段间转化连接器 */}
          {s.conv && i < stages.length - 1 ? (
            <div className="flex items-center gap-1 py-1 pl-1 text-xs text-muted-foreground">
              <ChevronDown className="size-3.5" />
              {s.conv.label}
              <span className="ml-0.5 font-mono font-medium text-foreground">{s.conv.value}</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
