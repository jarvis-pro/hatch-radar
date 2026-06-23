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
      if (start === null) {
        start = now;
      }
      const elapsed = now - start - delay;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, elapsed / duration);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setVal(target);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);

  return val;
}
