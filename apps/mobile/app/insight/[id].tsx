import { IntensityBadge } from '@/components/intensity-badge';
import { TriageEditor } from '@/components/triage-editor';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { getComments, getInsight, getPost } from '@/db/queries';
import { getTriage } from '@/db/triage';
import { channelLabel, fmtDate, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CommentRow, Intensity } from '@hatch-radar/shared';
import { useLocalSearchParams } from 'expo-router';
import {
  ArrowBigUp,
  FileText,
  Flame,
  Lightbulb,
  MessagesSquare,
  SearchX,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

/** 强度 → 痛点卡左缘强调条颜色 */
const ACCENT_CLASS: Record<Intensity, string> = {
  HIGH: 'border-l-destructive',
  MEDIUM: 'border-l-warning',
  LOW: 'border-l-success',
};

export default function InsightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insightId = Number(id);

  const data = useMemo(() => {
    const insight = getInsight(insightId);
    if (!insight) return null;
    const post = getPost(insight.postId);
    const comments = post ? getComments(post.id) : [];
    return { insight, post, comments };
  }, [insightId]);

  // 研判数据单独成状态：编辑器每次落库后刷新视图
  const [triage, setTriage] = useState(() => getTriage(insightId));
  const refreshTriage = useCallback(() => setTriage(getTriage(insightId)), [insightId]);

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-6">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Icon as={SearchX} size={24} className="text-muted-foreground" />
        </View>
        <Text className="text-sm text-muted-foreground">洞察不存在（可能尚未导入对应批次）。</Text>
      </View>
    );
  }
  const { insight, post, comments } = data;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
        {/* 标题区 */}
        <View className="gap-2">
          <View className="flex-row flex-wrap items-center gap-2">
            <IntensityBadge intensity={insight.intensity} />
            <Text className="text-xs text-muted-foreground">
              {channelLabel(insight.source, insight.subreddit)}
            </Text>
            <Text className="text-xs text-muted-foreground">{fmtDate(insight.createdAt)}</Text>
          </View>
          <Text className="text-xl font-bold leading-snug">{insight.postTitle}</Text>
          {insight.tags.length > 0 ? (
            <View className="flex-row flex-wrap gap-1.5">
              {insight.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  <Text>{tag}</Text>
                </Badge>
              ))}
            </View>
          ) : null}
        </View>

        <TriageEditor triage={triage} onChanged={refreshTriage} />

        <Section icon={Flame} title="痛点" count={insight.painPoints.length}>
          {insight.painPoints.length === 0 ? (
            <Text className="text-sm text-muted-foreground">本帖未提炼出实质痛点信号。</Text>
          ) : (
            insight.painPoints.map((pain, idx) => (
              <Card
                key={idx}
                className={cn('gap-0 border-l-4 py-3.5 shadow-none', ACCENT_CLASS[pain.intensity])}
              >
                <CardContent className="gap-1.5 px-4">
                  <Text className="text-base font-medium leading-snug">{pain.description}</Text>
                  {pain.evidence ? (
                    <Text className="border-l-2 border-border pl-2.5 text-sm leading-5 text-muted-foreground">
                      “{pain.evidence}”
                    </Text>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </Section>

        <Section icon={Lightbulb} title="产品机会" count={insight.opportunities.length}>
          {insight.opportunities.length === 0 ? (
            <Text className="text-sm text-muted-foreground">本帖未推导出可行的产品方向。</Text>
          ) : (
            insight.opportunities.map((opp, idx) => (
              <Card key={idx} className="gap-0 py-3.5 shadow-none">
                <CardContent className="gap-1.5 px-4">
                  <Text className="text-base font-semibold leading-snug">{opp.title}</Text>
                  <Text className="text-sm leading-5">{opp.description}</Text>
                  {opp.target_user ? (
                    <Text className="text-xs text-muted-foreground">
                      目标用户:{opp.target_user}
                    </Text>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </Section>

        <Section icon={FileText} title={post ? '原帖' : '原帖（未随批次导入或已归档）'}>
          {post ? (
            <Card className="gap-0 border-0 bg-muted/60 py-3.5 shadow-none">
              <CardContent className="gap-2 px-4">
                {post.selftext ? (
                  <Text className="text-sm leading-6">{post.selftext}</Text>
                ) : (
                  <Text className="text-sm text-muted-foreground">（外链帖，无正文）</Text>
                )}
                <View className="flex-row items-center gap-3">
                  <View className="flex-row items-center gap-1">
                    <Icon as={ArrowBigUp} size={14} className="text-muted-foreground" />
                    <Text className="text-xs text-muted-foreground">{post.score}</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Icon as={MessagesSquare} size={14} className="text-muted-foreground" />
                    <Text className="text-xs text-muted-foreground">{post.num_comments}</Text>
                  </View>
                  <Text className="text-xs text-muted-foreground">{fmtDate(post.created_utc)}</Text>
                </View>
              </CardContent>
            </Card>
          ) : null}
        </Section>

        {post ? (
          <Section icon={MessagesSquare} title="评论" count={comments.length}>
            {comments.length === 0 ? (
              <Text className="text-sm text-muted-foreground">批次中没有该帖的评论。</Text>
            ) : (
              comments.map((c) => <CommentItem key={c.id} comment={c} />)
            )}
          </Section>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** 分区：图标 + 标题 + 计数徽标 */
function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2.5">
      <View className="mt-1 flex-row items-center gap-2">
        <Icon as={icon} size={16} className="text-muted-foreground" />
        <Text className="text-base font-semibold">{title}</Text>
        {count != null ? (
          <Badge variant="secondary">
            <Text>{count}</Text>
          </Badge>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** 评论：线程式缩进（最多 4 级），子级带引导线 */
function CommentItem({ comment }: { comment: CommentRow }) {
  return (
    <View
      className={cn('gap-1', comment.depth > 0 && 'border-l-2 border-border pl-3')}
      style={{ marginLeft: Math.min(comment.depth, 4) * 12 }}
    >
      <Text className="text-xs text-muted-foreground">
        <Text className="text-xs font-medium text-foreground">{comment.author ?? '[已删除]'}</Text>
        {comment.score > 0 ? ` · ▲ ${comment.score}` : ''} · {timeAgo(comment.created_utc)}
      </Text>
      <Text className="text-sm leading-5">{comment.body}</Text>
    </View>
  );
}
