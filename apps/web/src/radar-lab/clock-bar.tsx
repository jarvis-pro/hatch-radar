/**
 * 模拟时钟控制条（radar-lab 各页通用）：sim 时刻脉动 + 倍速 + 暂停/单步 + 重置。
 * 这是「上帝视角」演示控制——让评审能暂停、快进、单步看清这台雷达怎么活着跑。
 *
 * 响应式：桌面（sm+）整条内联展开；移动端收口成一颗「时刻」胶囊，点开 Popover 取全部控件，
 * 免得控制条在窄屏把顶栏撑出横向滚动（核心控件——倍速 / 暂停 / 单步 / 重置——窄屏仍可用）。
 */
import { ChevronDown, Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@hatch-radar/ui/components/popover';
import { cn } from '@hatch-radar/ui/lib/utils';
import { SPEED_OPTIONS, type Speed } from './constants';
import { resetWorld, setSpeed, stepOnce, togglePaused, useClock } from './store';

function hhmmss(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 时刻读数：脉冲点（暂停转灰、运行脉动）+ 等宽时分秒。桌面内联与移动胶囊共用。 */
function ClockReadout({ nowMs, paused }: { nowMs: number; paused: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          'size-1.5 rounded-full',
          paused ? 'bg-muted-foreground/50' : 'signal-pulse bg-signal',
        )}
      />
      <span className="font-mono tabular-nums text-foreground">{hhmmss(nowMs)}</span>
    </span>
  );
}

/** 控件组：倍速档位 + 暂停/继续 +（暂停时）单步 + 重置。桌面内联与移动 Popover 共用。 */
function ClockControls({ speed, paused }: { speed: Speed; paused: boolean }) {
  return (
    <>
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
    </>
  );
}

export function ClockBar() {
  const { nowMs, speed, paused } = useClock();
  return (
    <>
      {/* 桌面（sm+）：整条内联展开 */}
      <div className="hidden items-center gap-1.5 rounded-md border bg-card/80 px-2 py-1 text-xs sm:inline-flex">
        <ClockReadout nowMs={nowMs} paused={paused} />
        <span className="text-border">|</span>
        <ClockControls speed={speed} paused={paused} />
      </div>

      {/* 移动端：收口成「时刻」胶囊，点开取全部控件（脉冲点已示暂停/运行态） */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="模拟时钟控制"
            className="inline-flex items-center gap-1.5 rounded-md border bg-card/80 px-2 py-1 text-xs sm:hidden"
          >
            <ClockReadout nowMs={nowMs} paused={paused} />
            <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-auto items-center gap-1.5 p-1.5 text-xs">
          <ClockControls speed={speed} paused={paused} />
        </PopoverContent>
      </Popover>
    </>
  );
}
