import { dbFilePath } from '@/lib/db';

/** 列表为空时的占位提示 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="notice">
      <h2>{title}</h2>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

/** 数据库文件不存在时的引导提示（控制台只读，不主动建库） */
export function DbSetupNotice() {
  return (
    <div className="notice">
      <h2>数据库未就绪</h2>
      <p>
        未找到 SQLite 数据文件：<code>{dbFilePath()}</code>
      </p>
      <p>
        请先启动工作台进程生成数据（<code>pnpm dev</code> 或 <code>pnpm db:migrate</code>），
        或通过环境变量 <code>DATABASE_URL</code> 指定数据文件位置。
        控制台为只读端，不会创建或修改数据库。
      </p>
    </div>
  );
}
