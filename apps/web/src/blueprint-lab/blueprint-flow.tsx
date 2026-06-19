/**
 * 图纸流程预览（纯 CSS 线性条，无 react-flow）—— 把图纸的执行流程（flow DAG）按 x 顺序平铺只读展示。
 * 完整的连线编辑（增删环节 / 任意连线 / 挂闸门）后续在编辑器里做；此处仅预览「图纸长什么样」。
 * 容器宽度不足时水平滚动；派生环节虚线弱化。
 */
import { cn } from '@hatch-radar/ui/lib/utils';
import { stageType } from './constants';
import type { FlowGraph } from './types';

export function BlueprintFlow({ flow }: { flow: FlowGraph }) {
  const stages = [...flow.nodes]
    .sort((a, b) => a.position.x - b.position.x)
    .map((n) => {
      const t = stageType(n.type);
      return { id: n.id, label: t?.label ?? n.type, derived: t?.derived ?? false };
    });

  return (
    <div className="overflow-x-auto rounded-lg bg-muted/20 px-4 py-5">
      <div className="flex min-w-max items-center">
        {stages.map((stage, i) => (
          <div key={stage.id} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  'mx-1.5 w-7 shrink-0',
                  stage.derived
                    ? 'border-t-2 border-dashed border-border'
                    : 'border-t-2 border-primary/40',
                )}
              />
            )}
            <div
              className={cn(
                'flex w-44 items-center gap-2.5 rounded-xl border-2 bg-card px-3 py-2.5 shadow-sm',
                stage.derived ? 'border-dashed border-border opacity-70' : 'border-primary/40',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  stage.derived ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'truncate text-sm leading-tight',
                    stage.derived ? 'text-muted-foreground' : 'font-medium text-foreground',
                  )}
                >
                  {stage.label}
                </div>
                {stage.derived ? (
                  <div className="text-[10px] leading-tight text-muted-foreground">派生</div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
