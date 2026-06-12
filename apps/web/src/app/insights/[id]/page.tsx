import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnalyzedBadge, IntensityBadge, SourceBadge } from '@/components/badges';
import { DbSetupNotice } from '@/components/empty';
import { tryGetDb } from '@/lib/db';
import { channelLabel, fmtDate, permalinkUrl, TRIAGE_STATUS_LABELS } from '@/lib/format';
import { getInsight, getPost, getTriageForInsight } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function InsightDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const db = tryGetDb();
  if (!db) return <DbSetupNotice />;

  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  const insight = getInsight(db, numericId);
  if (!insight) notFound();
  // 30 天归档后原始帖子可能已删除，洞察永久保留（post 为软引用）
  const post = getPost(db, insight.postId);
  // 移动端离线研判后同步回传的结果；未同步过为 null
  const triage = getTriageForInsight(db, numericId);

  return (
    <article className="detail">
      <div className="card-meta">
        <IntensityBadge intensity={insight.intensity} />
        <SourceBadge source={insight.source} />
        <span>{channelLabel(insight.source, insight.subreddit)}</span>
        <time>{fmtDate(insight.createdAt)}</time>
        <span className="muted">模型 {insight.model}</span>
      </div>
      <h1 className="detail-title">{insight.postTitle}</h1>
      <div className="detail-links">
        {insight.permalink ? (
          <a href={permalinkUrl(insight.permalink)} target="_blank" rel="noreferrer noopener">
            查看原帖 ↗
          </a>
        ) : null}
        {post ? <Link href={`/posts/${post.id}`}>站内帖子与评论 →</Link> : null}
        {post ? <AnalyzedBadge analyzedAt={post.analyzed_at} /> : null}
      </div>

      {insight.tags.length > 0 ? (
        <div className="tag-row">
          {insight.tags.map((tag) => (
            <Link className="tag" key={tag} href={`/?q=${encodeURIComponent(tag)}`}>
              {tag}
            </Link>
          ))}
        </div>
      ) : null}

      {triage ? (
        <section>
          <h2 className="section-title">人工研判（移动端同步）</h2>
          <div className="triage-box">
            <div className="card-meta">
              <span className={`badge triage-${triage.status}`}>
                {TRIAGE_STATUS_LABELS[triage.status]}
              </span>
              {triage.rating != null ? (
                <span className="triage-rating">
                  {'★'.repeat(triage.rating)}
                  {'☆'.repeat(5 - triage.rating)}
                </span>
              ) : null}
              <span className="muted">更新于 {fmtDate(triage.updatedAt)}</span>
            </div>
            {triage.tags.length > 0 ? (
              <div className="tag-row">
                {triage.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            {triage.note ? <p className="triage-note">{triage.note}</p> : null}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="section-title">痛点（{insight.painPoints.length}）</h2>
        {insight.painPoints.length === 0 ? (
          <p className="muted">本帖未提炼出实质痛点信号。</p>
        ) : (
          <ul className="pain-list">
            {insight.painPoints.map((pain, idx) => (
              <li className={`pain pain-${pain.intensity.toLowerCase()}`} key={idx}>
                <div className="pain-head">
                  <IntensityBadge intensity={pain.intensity} />
                  <p className="pain-desc">{pain.description}</p>
                </div>
                {pain.evidence ? (
                  <blockquote className="evidence">{pain.evidence}</blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-title">产品机会（{insight.opportunities.length}）</h2>
        {insight.opportunities.length === 0 ? (
          <p className="muted">本帖未推导出可行的产品方向。</p>
        ) : (
          <ul className="opportunity-list">
            {insight.opportunities.map((opp, idx) => (
              <li className="opportunity" key={idx}>
                <h3>★ {opp.title}</h3>
                <p>{opp.description}</p>
                {opp.target_user ? <p className="muted">目标用户：{opp.target_user}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
