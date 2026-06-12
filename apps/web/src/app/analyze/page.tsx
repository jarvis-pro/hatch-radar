import { AnalyzeRow } from '@/components/analyze-row';
import { DbSetupNotice, EmptyState } from '@/components/empty';
import { Pagination } from '@/components/pagination';
import { tryGetDb } from '@/lib/db';
import { channelLabel, parsePage } from '@/lib/format';
import { countManualInsights, listAwaitingManualResult } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export const metadata = { title: '闭环回填' };

/** 闭环回填页的 URL 查询参数 */
interface SearchParams {
  /** 页码（从 1 开始，字符串形式） */
  page?: string;
}

export default async function AnalyzePage(props: { searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const db = tryGetDb();
  if (!db) return <DbSetupNotice />;

  const result = listAwaitingManualResult(db, parsePage(sp.page));
  const filled = countManualInsights(db);

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">
        闭环回填{' '}
        <span className="text-sm font-normal text-muted-foreground">
          file 模式：把外部 AI 结果粘回，闭合数据
        </span>
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        待回填 <span className="font-medium text-foreground tabular-nums">{result.total}</span> · 已回填{' '}
        <span className="font-medium text-foreground tabular-nums">{filled}</span>
      </p>

      {result.items.length === 0 ? (
        <EmptyState
          title="没有待回填的帖子"
          hint="启动 server（file 模式）抓取并导出待分析文档后，这里会列出等待回填 AI 结果的帖子。"
        />
      ) : (
        <div className="space-y-2">
          {result.items.map((post) => (
            <AnalyzeRow
              key={post.id}
              postId={post.id}
              title={post.title}
              channel={channelLabel(post.source, post.subreddit)}
            />
          ))}
        </div>
      )}

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/analyze"
        query={{}}
      />
    </>
  );
}
