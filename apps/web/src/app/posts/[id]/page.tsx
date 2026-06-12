import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnalyzedBadge, SourceBadge } from '@/components/badges';
import { CommentTree } from '@/components/comment-tree';
import { DbSetupNotice } from '@/components/empty';
import { tryGetDb } from '@/lib/db';
import { channelLabel, fmtDate, permalinkUrl } from '@/lib/format';
import { getComments, getInsightForPost, getPost } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function PostDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const db = tryGetDb();
  if (!db) return <DbSetupNotice />;

  const post = getPost(db, id);
  if (!post) notFound();
  const comments = getComments(db, post.id);
  const insight = getInsightForPost(db, post.id);

  return (
    <article className="detail">
      <div className="card-meta">
        <SourceBadge source={post.source} />
        <span>{channelLabel(post.source, post.subreddit)}</span>
        {post.author ? <span>by {post.author}</span> : null}
        <span>▲ {post.score}</span>
        <time>{fmtDate(post.created_utc)}</time>
        <AnalyzedBadge analyzedAt={post.analyzed_at} />
      </div>
      <h1 className="detail-title">{post.title}</h1>
      <div className="detail-links">
        {post.permalink ? (
          <a href={permalinkUrl(post.permalink)} target="_blank" rel="noreferrer noopener">
            查看原帖 ↗
          </a>
        ) : null}
        {post.url && post.url !== post.permalink ? (
          <a href={post.url} target="_blank" rel="noreferrer noopener">
            外部链接 ↗
          </a>
        ) : null}
        {insight ? <Link href={`/insights/${insight.id}`}>查看 AI 洞察 →</Link> : null}
      </div>

      {post.selftext ? <div className="selftext">{post.selftext}</div> : null}

      <section>
        <h2 className="section-title">评论（{comments.length}）</h2>
        <CommentTree comments={comments} />
      </section>
    </article>
  );
}
