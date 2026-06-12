import Link from 'next/link';
import type { Insight } from '@hatch-radar/shared';
import { channelLabel, timeAgo } from '@/lib/format';
import { IntensityBadge, SourceBadge } from './badges';

/** 洞察列表卡片：标题 + 首个痛点摘要 + 标签 */
export function InsightCard({ insight }: { insight: Insight }) {
  const firstPain = insight.painPoints[0];
  return (
    <article className="card">
      <div className="card-meta">
        <IntensityBadge intensity={insight.intensity} />
        <SourceBadge source={insight.source} />
        <span>{channelLabel(insight.source, insight.subreddit)}</span>
        <time>{timeAgo(insight.createdAt)}</time>
      </div>
      <h3 className="card-title">
        <Link href={`/insights/${insight.id}`}>{insight.postTitle}</Link>
      </h3>
      {firstPain ? <p className="card-excerpt">{firstPain.description}</p> : null}
      <div className="card-foot">
        {insight.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
        <span className="card-counts">
          痛点 {insight.painPoints.length} · 机会 {insight.opportunities.length}
        </span>
      </div>
    </article>
  );
}
