import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ArrowUp, ExternalLink } from 'lucide-react';
import { Card } from '@hatch-radar/ui/components/card';
import { Separator } from '@hatch-radar/ui/components/separator';
import { AnalyzedBadge, SourceBadge } from '@/components/badges';
import { CommentTree } from '@/components/comment-tree';
import { DbSetupNotice } from '@/components/empty';
import { tryGetDb } from '@/lib/db';
import { channelLabel, fmtDate, permalinkUrl } from '@/lib/format';
import { getComments, getInsightForPost, getPost } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function PostDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const db = await tryGetDb();
  if (!db) return <DbSetupNotice />;

  const post = await getPost(db, id);
  if (!post) notFound();
  const [comments, insight] = await Promise.all([
    getComments(db, post.id),
    getInsightForPost(db, post.id),
  ]);

  return (
    <Card className="gap-0 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <SourceBadge source={post.source} />
        <span>{channelLabel(post.source, post.subreddit)}</span>
        {post.author ? <span>by {post.author}</span> : null}
        <span className="inline-flex items-center gap-0.5 tabular-nums">
          <ArrowUp className="size-3" />
          {post.score}
        </span>
        <time>{fmtDate(post.created_utc)}</time>
        <AnalyzedBadge analyzedAt={post.analyzed_at} />
      </div>
      <h1 className="mt-3 text-xl leading-snug font-semibold tracking-tight">{post.title}</h1>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {post.permalink ? (
          <a
            href={permalinkUrl(post.permalink)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            查看原帖
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        {post.url && post.url !== post.permalink ? (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            外部链接
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        {insight ? (
          <Link
            href={`/insights/${insight.id}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            查看 AI 洞察
            <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {post.selftext ? (
        <div className="mt-4 rounded-md bg-muted p-3 text-sm whitespace-pre-wrap break-words">
          {post.selftext}
        </div>
      ) : null}

      <Separator className="my-5" />
      <h2 className="mb-3 text-base font-semibold">评论（{comments.length}）</h2>
      <CommentTree comments={comments} />
    </Card>
  );
}
