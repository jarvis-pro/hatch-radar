import type { ReactNode } from 'react';

/** PageHeader props */
interface PageHeaderProps {
  /** 页面标题（可见 H1，进页面的视觉焦点） */
  title: ReactNode;
  /** 页面说明（H1 下方次级文案） */
  description?: ReactNode;
  /** 右侧操作区（导出 / 实时指示等） */
  actions?: ReactNode;
}

/**
 * 页面引导区：可见页面标题（H1）+ 说明文案 + 右侧操作。
 * 顶栏面包屑负责「我在哪 / 导航返回」，页内 H1 负责「进页面的焦点」——二者职责不同，
 * 标题做大做重以建立层级（见 docs/web-design-audit.md P2.1）。
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-balance text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
