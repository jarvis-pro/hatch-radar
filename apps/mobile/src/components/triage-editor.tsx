import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { setNote, setRating, setStatus, setTags } from '@/db/triage';
import { TRIAGE_STATUS_LABELS } from '@/lib/format';
import { hapticSelect, hapticTap } from '@/lib/haptics';
import { TRIAGE_STATUSES, type Triage, type TriageStatus } from '@hatch-radar/shared';
import { Star, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

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
    hapticSelect();
    setStatus(insightId, status);
    onChanged();
  };

  // 点已选中的星级 = 清除评级
  const onStar = (star: number) => {
    hapticTap();
    setRating(insightId, star === triage.rating ? null : star);
    onChanged();
  };

  const onAddTag = () => {
    const tag = tagDraft.trim();
    if (!tag || triage.tags.includes(tag)) {
      setTagDraft('');
      return;
    }
    hapticSelect();
    setTags(insightId, [...triage.tags, tag]);
    setTagDraft('');
    onChanged();
  };

  const onRemoveTag = (tag: string) => {
    hapticSelect();
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
    <Card className="gap-4 border-primary/20 py-4 shadow-none">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="text-primary">人工研判</CardTitle>
        <CardDescription>离线编辑，回到工作台局域网后一键同步。</CardDescription>
      </CardHeader>
      <CardContent className="gap-4 px-4">
        {/* 研判状态 */}
        <ToggleGroup
          type="single"
          variant="outline"
          value={triage.status}
          onValueChange={(value) => {
            if (value) {
              onStatus(value as TriageStatus);
            }
          }}
          className="w-full"
        >
          {TRIAGE_STATUSES.map((status, idx) => (
            <ToggleGroupItem
              key={status}
              value={status}
              isFirst={idx === 0}
              isLast={idx === TRIAGE_STATUSES.length - 1}
              className="flex-1"
            >
              <Text>{TRIAGE_STATUS_LABELS[status]}</Text>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {/* 评级 */}
        <View className="flex-row items-center gap-1">
          <Text className="mr-2 text-sm font-sans-md text-muted-foreground">评级</Text>
          {[1, 2, 3, 4, 5].map((star) => {
            const filled = triage.rating != null && star <= triage.rating;
            return (
              <Pressable
                key={star}
                className="h-10 w-10 items-center justify-center active:opacity-70"
                onPress={() => onStar(star)}
              >
                <Icon
                  as={Star}
                  size={22}
                  className={filled ? 'text-warning' : 'text-muted-foreground/40'}
                  fill={filled ? 'currentColor' : 'transparent'}
                />
              </Pressable>
            );
          })}
          {triage.rating != null ? (
            <Text className="text-xs text-muted-foreground">再点一次清除</Text>
          ) : null}
        </View>

        {/* 标签 */}
        <View className="gap-2.5">
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text className="mr-0.5 text-sm font-sans-md text-muted-foreground">标签</Text>
            {triage.tags.length === 0 ? (
              <Text className="text-xs text-muted-foreground">还没有标签</Text>
            ) : (
              triage.tags.map((tag) => (
                <Pressable key={tag} className="active:opacity-70" onPress={() => onRemoveTag(tag)}>
                  <Badge variant="secondary" className="gap-1 pr-1.5">
                    <Text>{tag}</Text>
                    <Icon as={X} size={12} className="text-muted-foreground" />
                  </Badge>
                </Pressable>
              ))
            )}
          </View>
          <View className="flex-row gap-2">
            <Input
              className="flex-1"
              placeholder="添加研判标签…"
              value={tagDraft}
              onChangeText={setTagDraft}
              onSubmitEditing={onAddTag}
              returnKeyType="done"
            />
            <Button variant="secondary" onPress={onAddTag} disabled={tagDraft.trim().length === 0}>
              <Text>添加</Text>
            </Button>
          </View>
        </View>

        {/* 笔记 */}
        <View className="gap-2">
          <Textarea
            placeholder="记录研判想法（仅保存在本机，同步后回传工作台）"
            value={noteDraft}
            onChangeText={setNoteDraft}
            numberOfLines={4}
            className="min-h-24"
          />
          {noteDirty ? (
            <Button onPress={onSaveNote}>
              <Text>保存笔记</Text>
            </Button>
          ) : null}
        </View>
      </CardContent>
    </Card>
  );
}
