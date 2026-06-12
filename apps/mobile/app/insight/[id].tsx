import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { CommentRow } from '@hatch-radar/shared';
import { TriageEditor } from '../../src/components/triage-editor';
import { getComments, getInsight, getPost } from '../../src/db/queries';
import { getTriage } from '../../src/db/triage';
import {
  channelLabel,
  fmtDate,
  INTENSITY_BG,
  INTENSITY_COLORS,
  INTENSITY_LABELS,
  timeAgo,
} from '../../src/lib/format';

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
      <View style={styles.center}>
        <Text style={styles.muted}>洞察不存在（可能尚未导入对应批次）。</Text>
      </View>
    );
  }
  const { insight, post, comments } = data;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: INTENSITY_BG[insight.intensity] }]}>
            <Text style={[styles.badgeText, { color: INTENSITY_COLORS[insight.intensity] }]}>
              {INTENSITY_LABELS[insight.intensity]}强度
            </Text>
          </View>
          <Text style={styles.muted}>{channelLabel(insight.source, insight.subreddit)}</Text>
          <Text style={styles.muted}>{fmtDate(insight.createdAt)}</Text>
        </View>
        <Text style={styles.title}>{insight.postTitle}</Text>
        {insight.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {insight.tags.map((tag) => (
              <Text key={tag} style={styles.tag}>
                {tag}
              </Text>
            ))}
          </View>
        ) : null}

        <TriageEditor triage={triage} onChanged={refreshTriage} />

        <Text style={styles.sectionTitle}>痛点（{insight.painPoints.length}）</Text>
        {insight.painPoints.length === 0 ? (
          <Text style={styles.muted}>本帖未提炼出实质痛点信号。</Text>
        ) : (
          insight.painPoints.map((pain, idx) => (
            <View
              key={idx}
              style={[styles.painCard, { borderLeftColor: INTENSITY_COLORS[pain.intensity] }]}
            >
              <Text style={styles.painDesc}>{pain.description}</Text>
              {pain.evidence ? <Text style={styles.evidence}>“{pain.evidence}”</Text> : null}
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>产品机会（{insight.opportunities.length}）</Text>
        {insight.opportunities.length === 0 ? (
          <Text style={styles.muted}>本帖未推导出可行的产品方向。</Text>
        ) : (
          insight.opportunities.map((opp, idx) => (
            <View key={idx} style={styles.oppCard}>
              <Text style={styles.oppTitle}>★ {opp.title}</Text>
              <Text style={styles.oppDesc}>{opp.description}</Text>
              {opp.target_user ? (
                <Text style={styles.muted}>目标用户：{opp.target_user}</Text>
              ) : null}
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>原帖{post ? '' : '（未随批次导入或已归档）'}</Text>
        {post ? (
          <View style={styles.postCard}>
            {post.selftext ? (
              <Text style={styles.postBody}>{post.selftext}</Text>
            ) : (
              <Text style={styles.muted}>（外链帖，无正文）</Text>
            )}
            <Text style={styles.postMeta}>
              ▲ {post.score} · 评论 {post.num_comments} · {fmtDate(post.created_utc)}
            </Text>
          </View>
        ) : null}

        {post ? (
          <>
            <Text style={styles.sectionTitle}>评论（{comments.length}）</Text>
            {comments.length === 0 ? (
              <Text style={styles.muted}>批次中没有该帖的评论。</Text>
            ) : (
              comments.map((c) => <CommentItem key={c.id} comment={c} />)
            )}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CommentItem({ comment }: { comment: CommentRow }) {
  return (
    <View style={[styles.comment, { marginLeft: Math.min(comment.depth, 4) * 14 }]}>
      <Text style={styles.commentMeta}>
        {comment.author ?? '[已删除]'}
        {comment.score > 0 ? ` · ▲ ${comment.score}` : ''} · {timeAgo(comment.created_utc)}
      </Text>
      <Text style={styles.commentBody}>{comment.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontSize: 11.5 },
  muted: { fontSize: 12.5, color: '#6b7585' },
  title: { fontSize: 18, fontWeight: '700', color: '#1c2330', lineHeight: 25 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    backgroundColor: '#eef1f5',
    color: '#1c2330',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 1,
    fontSize: 12,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1c2330',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e3e7ee',
  },
  painCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    borderLeftWidth: 3,
    padding: 12,
    gap: 6,
  },
  painDesc: { fontSize: 14, color: '#1c2330', fontWeight: '500', lineHeight: 20 },
  evidence: { fontSize: 12.5, color: '#6b7585', lineHeight: 18 },
  oppCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    padding: 12,
    gap: 4,
  },
  oppTitle: { fontSize: 14.5, fontWeight: '600', color: '#1c2330' },
  oppDesc: { fontSize: 13.5, color: '#1c2330', lineHeight: 19 },
  postCard: {
    backgroundColor: '#eef1f5',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  postBody: { fontSize: 13.5, color: '#1c2330', lineHeight: 19 },
  postMeta: { fontSize: 12, color: '#6b7585' },
  comment: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    padding: 10,
    gap: 3,
    marginBottom: 8,
  },
  commentMeta: { fontSize: 12, color: '#6b7585' },
  commentBody: { fontSize: 13.5, color: '#1c2330', lineHeight: 19 },
});
