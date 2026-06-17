import type { ReactNode } from 'react';
import { Inbox, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@hatch-radar/ui/components/empty';

interface EmptyStateProps {
  /** 占位主标题，描述当前为空的内容 */
  title: string;
  /** 可选的辅助说明，提示用户后续操作 */
  hint?: string;
  /** 可选的「下一步行动」区（按钮/链接） */
  action?: ReactNode;
}

/** 列表为空时的占位提示 */
export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <Empty className="rounded-xl border border-dashed bg-card/40">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {hint ? <EmptyDescription>{hint}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/** 数据加载失败时的占位提示（server 不可达 / 接口报错；控制台经 /api 取数）。传 onRetry 显示「重试」。 */
export function LoadError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>加载失败</EmptyTitle>
        <EmptyDescription>{message ?? '无法连接服务，请稍后重试。'}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {onRetry ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          若持续失败，请确认工作台 server 进程已启动。
        </p>
      </EmptyContent>
    </Empty>
  );
}
