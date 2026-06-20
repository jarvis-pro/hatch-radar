/**
 * 模拟时钟控制条（radar-lab 各页通用）：sim 时刻脉动 + 倍速 + 暂停/单步 + 重置。
 * 这是「上帝视角」演示控制——让评审能暂停、快进、单步看清这台雷达怎么活着跑。
 */
import { Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { cn } from '@hatch-radar/ui/lib/utils';
import { SPEED_OPTIONS } from './constants';
import { resetWorld, setSpeed, stepOnce, togglePaused, useClock } from './store';

function hhmmss(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function ClockBar() {
  const { nowMs, speed, paused } = useClock();
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border bg-card/80 px-2 py-1 text-xs">
      <span className="inline-flex items-center gap-1.5 pr-0.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            paused ? 'bg-muted-foreground/50' : 'signal-pulse bg-signal',
          )}
        />
        <span className="font-mono tabular-nums text-foreground">{hhmmss(nowMs)}</span>
      </span>
      <span className="text-border">|</span>
      <div className="flex items-center gap-0.5">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={cn(
              'rounded px-1.5 py-0.5 font-medium tabular-nums transition-colors',
              speed === s
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            ×{s}
          </button>
        ))}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={togglePaused}
        aria-label={paused ? '继续' : '暂停'}
      >
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </Button>
      {paused ? (
        <Button size="icon-sm" variant="ghost" onClick={stepOnce} aria-label="单步推进">
          <StepForward className="size-4" />
        </Button>
      ) : null}
      <Button size="icon-sm" variant="ghost" onClick={resetWorld} aria-label="重置模拟">
        <RotateCcw className="size-4" />
      </Button>
    </div>
  );
}
