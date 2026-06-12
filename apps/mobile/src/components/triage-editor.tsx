import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { TRIAGE_STATUSES, type Triage, type TriageStatus } from '@hatch-radar/shared';
import { setNote, setRating, setStatus, setTags } from '../db/triage';
import { TRIAGE_STATUS_LABELS } from '../lib/format';

/**
 * 离线人工研判编辑器：状态 / 评级 / 标签 / 笔记。
 * 每次交互立即写本地 triage 表并向 outbox 追加操作日志（local-first），
 * 通过 onChanged 通知父组件刷新视图。全程离线可用。
 */
export function TriageEditor({ triage, onChanged }: { triage: Triage; onChanged: () => void }) {
  const insightId = triage.insightId;
  const [tagDraft, setTagDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState(triage.note);

  const onStatus = (status: TriageStatus) => {
    setStatus(insightId, status);
    onChanged();
  };

  // 点已选中的星级 = 清除评级
  const onStar = (star: number) => {
    setRating(insightId, star === triage.rating ? null : star);
    onChanged();
  };

  const onAddTag = () => {
    const tag = tagDraft.trim();
    if (!tag || triage.tags.includes(tag)) {
      setTagDraft('');
      return;
    }
    setTags(insightId, [...triage.tags, tag]);
    setTagDraft('');
    onChanged();
  };

  const onRemoveTag = (tag: string) => {
    setTags(
      insightId,
      triage.tags.filter((t) => t !== tag),
    );
    onChanged();
  };

  const noteDirty = noteDraft !== triage.note;
  const onSaveNote = () => {
    setNote(insightId, noteDraft.trim());
    setNoteDraft(noteDraft.trim());
    onChanged();
  };

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>人工研判（离线，确认后可同步回工作台）</Text>

      <View style={styles.segmentRow}>
        {TRIAGE_STATUSES.map((status) => {
          const active = triage.status === status;
          return (
            <Pressable
              key={status}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => onStatus(status)}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {TRIAGE_STATUS_LABELS[status]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.starRow}>
        <Text style={styles.label}>评级</Text>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable key={star} onPress={() => onStar(star)} hitSlop={6}>
            <Text
              style={[styles.star, triage.rating != null && star <= triage.rating && styles.starOn]}
            >
              {triage.rating != null && star <= triage.rating ? '★' : '☆'}
            </Text>
          </Pressable>
        ))}
        {triage.rating != null ? <Text style={styles.starHint}>（再点一次清除）</Text> : null}
      </View>

      <View style={styles.tagWrap}>
        <Text style={styles.label}>标签</Text>
        {triage.tags.map((tag) => (
          <Pressable key={tag} style={styles.tagChip} onPress={() => onRemoveTag(tag)}>
            <Text style={styles.tagChipText}>{tag} ✕</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.tagInputRow}>
        <TextInput
          style={styles.tagInput}
          placeholder="添加研判标签…"
          placeholderTextColor="#9aa3b2"
          value={tagDraft}
          onChangeText={setTagDraft}
          onSubmitEditing={onAddTag}
          returnKeyType="done"
        />
        <Pressable style={styles.tagAddBtn} onPress={onAddTag}>
          <Text style={styles.tagAddText}>添加</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>笔记</Text>
      <TextInput
        style={styles.noteInput}
        placeholder="记录研判想法（仅保存在本机，同步后回传工作台）"
        placeholderTextColor="#9aa3b2"
        value={noteDraft}
        onChangeText={setNoteDraft}
        multiline
      />
      {noteDirty ? (
        <Pressable style={styles.noteSaveBtn} onPress={onSaveNote}>
          <Text style={styles.noteSaveText}>保存笔记</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe2ec',
    padding: 12,
    gap: 10,
  },
  heading: { fontSize: 13, fontWeight: '600', color: '#2563eb' },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: '#eef1f5',
    borderRadius: 9,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, borderRadius: 7, paddingVertical: 7, alignItems: 'center' },
  segmentActive: { backgroundColor: '#2563eb' },
  segmentText: { fontSize: 13.5, color: '#1c2330' },
  segmentTextActive: { color: '#fff', fontWeight: '600' },
  label: { fontSize: 13, color: '#6b7585' },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  star: { fontSize: 24, color: '#c4ccd8', lineHeight: 28 },
  starOn: { color: '#d97706' },
  starHint: { fontSize: 11.5, color: '#9aa3b2' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  tagChip: {
    backgroundColor: '#eaf1fe',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  tagChipText: { fontSize: 12.5, color: '#2563eb' },
  tagInputRow: { flexDirection: 'row', gap: 8 },
  tagInput: {
    flex: 1,
    backgroundColor: '#f6f7f9',
    borderWidth: 1,
    borderColor: '#e3e7ee',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13.5,
    color: '#1c2330',
  },
  tagAddBtn: {
    backgroundColor: '#eef1f5',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  tagAddText: { fontSize: 13.5, color: '#1c2330' },
  noteInput: {
    backgroundColor: '#f6f7f9',
    borderWidth: 1,
    borderColor: '#e3e7ee',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13.5,
    color: '#1c2330',
    minHeight: 72,
    textAlignVertical: 'top',
  },
  noteSaveBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  noteSaveText: { color: '#fff', fontSize: 13.5, fontWeight: '600' },
});
