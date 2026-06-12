import Link from 'next/link';
import type { Insight } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@hatch-radar/ui/components/card';
import { channelLabel, timeAgo } from '@/lib/format';
import { IntensityBadge, SourceBadge } from './badges';

/** 洞察列表卡片：标题 + 首个痛点摘要 + 标签；整卡可点击进入详情 */
export function InsightCard({ insight }: { insight: Insight }) {
  const firstPain = insight.painPoints[0];

  return (
    <Card className="relative gap-3 py-4 transition-colors hover:bg-accent/40">
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <IntensityBadge intensity={insight.intensity} />
          <SourceBadge source={insight.source} />
          <span>{channelLabel(insight.source, insight.subreddit)}</span>
          <time className="ml-auto">{timeAgo(insight.createdAt)}</time>
        </div>
        <CardTitle className="text-base leading-snug">
          <Link
            href={`/insights/${insight.id}`}
            className="hover:text-primary after:absolute after:inset-0"
          >
            {insight.postTitle}
          </Link>
        </CardTitle>
      </CardHeader>
      {firstPain ? (
        <CardContent className="px-4">
          <p className="line-clamp-2 text-sm text-muted-foreground">{firstPain.description}</p>
        </CardContent>
      ) : null}
      <CardFooter className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4">
        {insight.tags.slice(0, 6).map((tag) => (
          <Badge key={tag} variant="secondary" className="font-normal">
            {tag}
          </Badge>
        ))}
        <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          痛点 {insight.painPoints.length} · 机会 {insight.opportunities.length}
        </span>
      </CardFooter>
    </Card>
  );
}
