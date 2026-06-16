import type { ReactNode } from 'react';

/** PageHeader props */
interface PageHeaderProps {
  /** 页面一级标题（24px，建立焦点；取代旧的 18px inline 写法） */
  title: ReactNode;
  /** 标题下方独立一行副标题（取代旧的「跟在标题后的灰字」） */
  description?: ReactNode;
  /** 右侧主操作区（导出 / 新建等） */
  actions?: ReactNode;
}

/**
 * 统一页面标题区：H1（24px / 字距收紧）+ 独立副标题 + 右侧操作槽。
 * 全站统一调用，解决「标题太小、层级太平」与各页标题写法不一的问题。
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight text-foreground">
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
