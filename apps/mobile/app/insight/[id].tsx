import { IntensityBadge } from '@/components/intensity-badge';
import { TriageEditor } from '@/components/triage-editor';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  getComments,
  getInsight,
  getPost,
  getPostTranslations,
  type PostTranslations,
} from '@/db/queries';
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
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

/** 强度 → 痛点卡左缘强调条颜色（对齐 Signal 强度令牌） */
const ACCENT_CLASS: Record<Intensity, string> = {
  HIGH: 'border-l-intensity-high',
  MEDIUM: 'border-l-intensity-medium',
  LOW: 'border-l-intensity-low',
};

export default function InsightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insightId = Number(id);

  const data = useMemo(() => {
    const insight = getInsight(insightId);
    if (!insight) {
      return null;
    }
    const post = getPost(insight.postId);
    const comments = post ? getComments(post.id) : [];
    const translations: PostTranslations = post ? getPostTranslations(post.id) : { comments: {} };
    return { insight, post, comments, translations };
  }, [insightId]);

  // 研判数据单独成状态：编辑器每次落库后刷新视图
  const [triage, setTriage] = useState(() => getTriage(insightId));
  const refreshTriage = useCallback(() => setTriage(getTriage(insightId)), [insightId]);
  // 中文优先开关：有译文时默认显示中文，可切回原文
  const [showZh, setShowZh] = useState(true);

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
  const { insight, post, comments, translations } = data;
  const hasTr =
    !!translations.title ||
    !!translations.selftext ||
    Object.keys(translations.comments).length > 0;

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
            {hasTr ? (
              <Pressable
                onPress={() => setShowZh((v) => !v)}
                className="rounded-md border border-border px-2 py-0.5"
              >
                <Text className="text-xs text-muted-foreground">
                  {showZh ? '显示原文' : '显示中文'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text className="text-xl font-sans-bd leading-snug">
            {(showZh ? translations.title : undefined) ?? insight.postTitle}
          </Text>
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
                  <Text className="text-base font-sans-md leading-snug">{pain.description}</Text>
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
                  <Text className="text-base font-sans-sb leading-snug">{opp.title}</Text>
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
            <Card className="gap-0 border-0 bg-muted py-3.5 shadow-none">
              <CardContent className="gap-2 px-4">
                {post.selftext ? (
                  <Text className="text-sm leading-6">
                    {(showZh ? translations.selftext : undefined) ?? post.selftext}
                  </Text>
                ) : (
                  <Text className="text-sm text-muted-foreground">（外链帖，无正文）</Text>
                )}
                <View className="flex-row items-center gap-3">
                  <View className="flex-row items-center gap-1">
                    <Icon as={ArrowBigUp} size={14} className="text-muted-foreground" />
                    <Text className="font-mono text-xs text-muted-foreground">{post.score}</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Icon as={MessagesSquare} size={14} className="text-muted-foreground" />
                    <Text className="font-mono text-xs text-muted-foreground">
                      {post.num_comments}
                    </Text>
                  </View>
                  <Text className="font-mono text-xs text-muted-foreground">
                    {fmtDate(post.created_utc)}
                  </Text>
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
              comments.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  zh={showZh ? translations.comments[c.id] : undefined}
                />
              ))
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
        <Text className="text-base font-sans-sb">{title}</Text>
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

/** 评论：线程式缩进（最多 4 级），子级带引导线；zh 有值时显示中文译文 */
function CommentItem({ comment, zh }: { comment: CommentRow; zh?: string }) {
  return (
    <View
      className={cn('gap-1', comment.depth > 0 && 'border-l-2 border-border pl-3')}
      style={{ marginLeft: Math.min(comment.depth, 4) * 12 }}
    >
      <Text className="text-xs text-muted-foreground">
        <Text className="text-xs font-sans-md text-foreground">{comment.author ?? '[已删除]'}</Text>
        {comment.score > 0 ? ` · ▲ ${comment.score}` : ''} · {timeAgo(comment.created_utc)}
      </Text>
      <Text className="text-sm leading-5">{zh ?? comment.body}</Text>
    </View>
  );
}
