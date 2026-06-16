import { Link } from 'react-router-dom';
import type { Insight } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@hatch-radar/ui/components/card';
import { cn } from '@hatch-radar/ui/lib/utils';
import { channelLabel, timeAgo } from '@/lib/format';
import { INTENSITY_BAR, IntensityBadge, SourceBadge } from './badges';

/** 洞察列表卡片：左侧强度色条 + 标题 + 首个痛点摘要 + 标签；整卡可点击进入详情 */
export function InsightCard({ insight }: { insight: Insight }) {
  const firstPain = insight.painPoints[0];

  return (
    <Card className="relative gap-2.5 overflow-hidden py-4 transition-colors hover:bg-accent/40">
      {/* 左侧强度色条：扫一眼即知信号强弱（信号优先原则） */}
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-1', INTENSITY_BAR[insight.intensity])}
      />
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <IntensityBadge intensity={insight.intensity} />
          <SourceBadge source={insight.source} />
          <span>{channelLabel(insight.source, insight.subreddit)}</span>
          <time className="ml-auto tabular-nums">{timeAgo(insight.createdAt)}</time>
        </div>
        <CardTitle className="text-[15px] leading-snug">
          <Link
            to={`/insights/${insight.id}`}
            className="after:absolute after:inset-0 hover:text-primary"
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
        <span className="ml-auto inline-flex items-center gap-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          <span>
            痛点 <span className="font-medium text-foreground">{insight.painPoints.length}</span>
          </span>
          <span>
            机会 <span className="font-medium text-foreground">{insight.opportunities.length}</span>
          </span>
        </span>
      </CardFooter>
    </Card>
  );
}
