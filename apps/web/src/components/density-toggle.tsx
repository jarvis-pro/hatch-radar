import { Rows2, Rows3 } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@hatch-radar/ui/components/toggle-group';
import type { Density } from '@/lib/use-density';

/** 列表密度切换（舒适 / 紧凑），与 useDensity 配套。 */
export function DensityToggle({
  value,
  onChange,
}: {
  value: Density;
  onChange: (d: Density) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as Density);
      }}
      variant="outline"
      size="sm"
      aria-label="列表密度"
    >
      <ToggleGroupItem value="comfortable" aria-label="舒适">
        <Rows2 className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="compact" aria-label="紧凑">
        <Rows3 className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
