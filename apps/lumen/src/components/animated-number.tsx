import { Text } from '@/components/ui/text';
import { compact, withCommas } from '@/lib/format';
import { useEffect, useState } from 'react';

/**
 * 数字滚动到目标值（easeOutCubic）。用 requestAnimationFrame 而非 reanimated 的
 * TextInput-text 技巧——后者在 web 上不更新文本，这里要保证浏览器演示也好看。
 */
export function useCountUp(target: number, opts?: { duration?: number; delay?: number }): number {
  const duration = opts?.duration ?? 1200;
  const delay = opts?.delay ?? 0;
  const [val, setVal] = useState(0);

  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const elapsed = now - start - delay;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, elapsed / duration);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);

  return val;
}

interface AnimatedNumberProps {
  value: number;
  format?: 'int' | 'compact';
  prefix?: string;
  suffix?: string;
  className?: string;
  duration?: number;
  delay?: number;
}

/** 数值文本，挂载时从 0 滚动到 value。等宽字呈现，数字不跳动。 */
export function AnimatedNumber({
  value,
  format = 'int',
  prefix = '',
  suffix = '',
  className,
  duration,
  delay,
}: AnimatedNumberProps) {
  const v = useCountUp(value, { duration, delay });
  const n = Math.round(v);
  const body = format === 'compact' ? compact(n) : withCommas(n);
  return (
    <Text className={className}>
      {prefix}
      {body}
      {suffix}
    </Text>
  );
}
