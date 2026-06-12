import { Database, Inbox } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@hatch-radar/ui/components/empty';
import { dbFilePath } from '@/lib/db';

/** 行内 code 样式（沿用主题 muted 底色，避免自定义 CSS） */
const code = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]';

/** 列表为空时的占位提示 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
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
          未找到 SQLite 数据文件：<code className={code}>{dbFilePath()}</code>
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <p>
          请先启动工作台进程生成数据（<code className={code}>pnpm dev</code> 或{' '}
          <code className={code}>pnpm db:migrate</code>），或通过环境变量{' '}
          <code className={code}>DATABASE_URL</code> 指定数据文件位置。
          控制台为只读端，不会创建或修改数据库。
        </p>
      </EmptyContent>
    </Empty>
  );
}
