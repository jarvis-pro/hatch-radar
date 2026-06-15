import { Inbox, TriangleAlert } from 'lucide-react';
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
}

/** 列表为空时的占位提示 */
export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {hint ? <EmptyDescription>{hint}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

/** 数据加载失败时的占位提示（server 不可达 / 接口报错；控制台经 /api 取数）。 */
export function LoadError({ message }: { message?: string }) {
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
        <p className="text-sm text-muted-foreground">
          若持续失败，请确认工作台 server 进程已启动。
        </p>
      </EmptyContent>
    </Empty>
  );
}
