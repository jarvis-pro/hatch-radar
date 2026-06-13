import { Database, Inbox } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@hatch-radar/ui/components/empty';
import { dbTarget } from '@/lib/db';

/** 行内 code 样式（沿用主题 muted 底色，避免自定义 CSS） */
const code = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]';

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

/** 数据库文件不存在时的引导提示（控制台只读，不主动建库） */
export function DbSetupNotice() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database />
        </EmptyMedia>
        <EmptyTitle>数据库未就绪</EmptyTitle>
        <EmptyDescription>
          无法连接 PostgreSQL：<code className={code}>{dbTarget()}</code>
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <p>
          请先启动数据库与工作台进程（<code className={code}>docker compose up -d db</code> 后{' '}
          <code className={code}>pnpm dev</code>），或通过环境变量{' '}
          <code className={code}>DATABASE_URL</code> 指定 PG 连接串。
          控制台为只读端，不会创建或修改数据库。
        </p>
      </EmptyContent>
    </Empty>
  );
}
