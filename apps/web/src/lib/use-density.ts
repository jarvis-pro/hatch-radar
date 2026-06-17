import { useCallback, useState } from 'react';

/** 列表密度：舒适（默认）/ 紧凑。 */
export type Density = 'comfortable' | 'compact';

const KEY = 'radar-density';

/** 列表密度偏好（localStorage 持久，跨页一致）。 */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>(() =>
    localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable',
  );
  const update = useCallback((d: Density) => {
    setDensity(d);
    try {
      localStorage.setItem(KEY, d);
    } catch {
      // localStorage 不可用（隐私模式等）时仅内存生效
    }
  }, []);
  return [density, update];
}
