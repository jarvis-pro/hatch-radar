import type { ReactNode } from 'react';

/** PageHeader props */
interface PageHeaderProps {
  /** 页面标题：仅渲染为 sr-only <h1> 保留无障碍语义；可见标题已由顶栏面包屑承担 */
  title: ReactNode;
  /** 页面说明 —— 现在是本区域唯一的可见主文案 */
  description?: ReactNode;
  /** 右侧操作区（导出 / 实时指示等） */
  actions?: ReactNode;
}

/**
 * 页面引导区：视觉上只保留「说明文案 + 右侧操作」。大标题已撤——区段名由顶栏面包屑给出
 * （见 top-bar.tsx），以此消除「面包屑 + 页内大 H1」的重复并回收纵向空间。title 仍以
 * sr-only <h1> 渲染，保留无障碍语义与文档大纲。
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="sr-only">{title}</h1>
        {description ? (
          <p className="text-sm text-balance text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
