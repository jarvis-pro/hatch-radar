import { Check, Loader2, X } from 'lucide-react';
import {
  INSPECT_STEP_LABELS,
  type InspectStepName,
  type InspectStepView,
} from '@hatch-radar/shared';
import { cn } from '@hatch-radar/ui/lib/utils';

/** 节点耗时（秒，整数）：done 节点展示。时间戳为整数秒，毫秒级节点显示「0s」。 */
function stepDuration(s: InspectStepView): string | null {
  if (s.startedAt == null) return null;
  const end = s.finishedAt ?? null;
  if (end == null) return null;
  return `${Math.max(0, end - s.startedAt)}s`;
}

/** 节点圆点的视觉态（按 status）。 */
function dotClass(status: string, selected: boolean): string {
  const base =
    'flex size-9 items-center justify-center rounded-full border-2 text-sm font-semibold';
  const ring = selected ? ' ring-2 ring-offset-2 ring-offset-background ring-primary' : '';
  switch (status) {
    case 'done':
      return `${base} border-primary bg-primary/10 text-primary${ring}`;
    case 'running':
      return `${base} border-primary bg-primary text-primary-foreground animate-pulse${ring}`;
    case 'failed':
      return `${base} border-destructive bg-destructive/10 text-destructive${ring}`;
    default:
      return `${base} border-border bg-muted/40 text-muted-foreground${ring}`;
  }
}

/**
 * 横向管道线路图：一眼看出任务跑在哪个节点。点节点切换下方产物面板。
 * pending 灰圈 / running 高亮脉冲 / done 绿勾 + 耗时 / failed 红叉。
 */
export function FlowDiagram({
  steps,
  selectedSeq,
  onSelect,
}: {
  steps: InspectStepView[];
  selectedSeq: number;
  onSelect: (seq: number) => void;
}) {
  return (
    <div className="flex items-start gap-1 overflow-x-auto pb-2">
      {steps.map((s, i) => {
        const label = INSPECT_STEP_LABELS[s.name as InspectStepName] ?? s.name;
        const dur = stepDuration(s);
        const selected = s.seq === selectedSeq;
        return (
          <div key={s.seq} className="flex items-start">
            <button
              type="button"
              onClick={() => onSelect(s.seq)}
              className="flex min-w-20 flex-col items-center gap-1.5 px-1 text-center"
              aria-current={selected ? 'step' : undefined}
            >
              <span className={dotClass(s.status, selected)}>
                {s.status === 'done' ? (
                  <Check className="size-4" />
                ) : s.status === 'failed' ? (
                  <X className="size-4" />
                ) : s.status === 'running' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  'text-xs leading-tight',
                  selected ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              <span className="h-3 text-[10px] tabular-nums text-muted-foreground">
                {s.status === 'running' ? '运行中…' : (dur ?? '')}
              </span>
            </button>
            {i < steps.length - 1 ? (
              <div
                className={cn(
                  'mt-[18px] h-0.5 w-4 shrink-0 sm:w-8',
                  steps[i].status === 'done' ? 'bg-primary' : 'bg-border',
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
