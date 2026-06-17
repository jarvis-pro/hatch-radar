import { SignalDot } from '@/components/signal-dot';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { importBatch, importSqliteFile, type ImportResult } from '@/db/import';
import { isEnrolled } from '@/lib/device-identity';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { pendingSyncCount, pushOutbox } from '@/lib/sync';
import { THEME } from '@/lib/theme';
import {
  fetchBatch,
  fetchHealth,
  loadWorkstationConfig,
  normalizeBaseUrl,
  saveWorkstationConfig,
} from '@/lib/workstation';
import type { ExportBatch } from '@hatch-radar/shared';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CloudDownload,
  CloudUpload,
  FileInput,
  Radio,
  ShieldCheck,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'done' | 'error'; text: string };

/** file:// URI → SQLite ATTACH 可用的本地绝对路径 */
function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function describeResult(r: ImportResult): string {
  return `导入完成：洞察新增 ${r.added}、更新 ${r.updated}；帖子 ${r.posts}、评论 ${r.comments}`;
}

export default function SyncScreen() {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];
  const router = useRouter();
  const saved = loadWorkstationConfig();
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? 'http://192.168.0.95:8787');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pending, setPending] = useState(0);
  const [enrolled, setEnrolled] = useState(false);

  // 进入页面时刷新待同步计数与激活状态（检测 → 提示，规格 §D）
  useFocusEffect(
    useCallback(() => {
      setPending(pendingSyncCount());
      setEnrolled(isEnrolled());
    }, []),
  );

  const busy = status.kind === 'busy';

  /** 统一的异步操作包装：忙态 + 错误兜底 + 触感回执 */
  const run = async (label: string, fn: () => Promise<string>) => {
    setStatus({ kind: 'busy', label });
    try {
      setStatus({ kind: 'done', text: await fn() });
      hapticSuccess();
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      hapticError();
    }
  };

  const cfgFromInputs = () => {
    const cfg = { baseUrl: normalizeBaseUrl(baseUrl) };
    saveWorkstationConfig(cfg);
    setBaseUrl(cfg.baseUrl);
    return cfg;
  };

  const onTest = () =>
    run('正在连接工作台…', async () => {
      const health = await fetchHealth(cfgFromInputs());
      const s = health.stats;
      return `工作台在线：洞察 ${s.insights} / 帖子 ${s.posts} / 评论 ${s.comments}（待分析 ${s.pendingAnalysis}）`;
    });

  const onPull = () =>
    run('正在拉取批次…', async () => {
      const batch = await fetchBatch(cfgFromInputs());
      return describeResult(importBatch(batch));
    });

  // 用户点击即视为确认推送（检测 → 提示 → 确认 → push，规格 §D）
  const onPush = () =>
    run('正在推送研判…', async () => {
      const summary = await pushOutbox(cfgFromInputs());
      setPending(pendingSyncCount());
      if (summary.total === 0) return '没有待同步的研判操作。';
      const parts = [`同步完成：共 ${summary.total} 条，应用 ${summary.applied}`];
      if (summary.duplicate > 0) parts.push(`重复跳过 ${summary.duplicate}`);
      if (summary.rejected > 0) {
        const reasons = [...new Set(summary.rejections.map((r) => r.reason ?? '原因见工作台日志'))];
        parts.push(`拒绝 ${summary.rejected}（${reasons.join('；')}）`);
      }
      return parts.join('，');
    });

  const onPickFile = () =>
    run('正在导入文件…', async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return '已取消选择。';
      const asset = picked.assets[0];
      const name = asset.name.toLowerCase();
      if (name.endsWith('.json')) {
        const text = await new File(asset.uri).text();
        return describeResult(importBatch(JSON.parse(text) as ExportBatch));
      }
      if (name.endsWith('.sqlite') || name.endsWith('.db')) {
        return describeResult(importSqliteFile(uriToPath(asset.uri)));
      }
      throw new Error(`不支持的文件类型：${asset.name}（需要 .json / .sqlite）`);
    });

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="gap-3 p-4 pb-10" keyboardShouldPersistTaps="handled">
        {/* 设备激活状态（前置条件，未激活时醒目引导） */}
        {enrolled ? (
          <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <SignalDot online />
            <Text className="flex-1 font-sans-md text-sm text-foreground">本机已激活</Text>
            <Pressable onPress={() => router.push('/activate')} className="active:opacity-70">
              <Text className="text-sm text-primary">管理</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => router.push('/activate')} className="active:opacity-80">
            <View className="flex-row items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
              <Icon as={ShieldCheck} size={18} className="text-warning" />
              <View className="flex-1 gap-0.5">
                <Text className="font-sans-md text-sm text-warning">本机尚未激活</Text>
                <Text className="text-xs leading-4 text-warning">
                  同步前需向管理员索取一次性激活码
                </Text>
              </View>
              <Icon as={ChevronRight} size={16} className="text-warning" />
            </View>
          </Pressable>
        )}

        {/* 获取情报：拉取 + 文件导入统一在一处 */}
        <Card className="gap-4 py-4 shadow-none">
          <CardHeader className="gap-1 px-4">
            <CardTitle>获取情报</CardTitle>
            <CardDescription className="leading-5">
              回工作台局域网拉取最新批次，或导入经 AirDrop / 文件 App 传来的 .sqlite / .json 批次。
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-3 px-4">
            <View className="gap-1.5">
              <Label>工作台地址</Label>
              <Input
                placeholder="http://192.168.0.95:8787"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={baseUrl}
                onChangeText={setBaseUrl}
                editable={!busy}
              />
            </View>

            <View className="flex-row gap-2.5">
              <Button variant="outline" className="flex-1" onPress={onTest} disabled={busy}>
                <Icon as={Radio} size={16} />
                <Text>测试连接</Text>
              </Button>
              <Button className="flex-1" onPress={onPull} disabled={busy}>
                <Icon as={CloudDownload} size={16} className="text-primary-foreground" />
                <Text>拉取并导入</Text>
              </Button>
            </View>

            <View className="flex-row items-center gap-2">
              <View className="h-px flex-1 bg-border" />
              <Text className="text-xs text-muted-foreground">或</Text>
              <View className="h-px flex-1 bg-border" />
            </View>

            <Button variant="outline" onPress={onPickFile} disabled={busy}>
              <Icon as={FileInput} size={16} />
              <Text>从文件导入</Text>
            </Button>
          </CardContent>
        </Card>

        {/* 推送研判 */}
        <Card className="gap-4 py-4 shadow-none">
          <CardHeader className="gap-1 px-4">
            <CardTitle>推送研判</CardTitle>
            <CardDescription className="leading-5">
              {pending > 0
                ? `有 ${pending} 条研判操作待同步。按发生顺序推送，工作台按 opId 幂等去重，重复推送不会重复应用。`
                : '所有研判操作均已同步。离线期间的状态/评级/标签/笔记变更会自动记入待同步队列。'}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <Button onPress={onPush} disabled={busy || pending === 0}>
              <Icon as={CloudUpload} size={16} className="text-primary-foreground" />
              <Text>{pending > 0 ? `确认推送 ${pending} 条研判` : '无待同步操作'}</Text>
            </Button>
          </CardContent>
        </Card>

        {status.kind === 'busy' ? (
          <View className="flex-row items-center gap-2.5 px-1">
            <ActivityIndicator size="small" color={theme.primary} />
            <Text className="text-sm text-muted-foreground">{status.label}</Text>
          </View>
        ) : null}
        {status.kind === 'done' ? (
          <View className="flex-row items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
            <Icon as={CircleCheck} size={16} className="mt-0.5 text-success" />
            <Text className="flex-1 text-sm leading-5 text-success">{status.text}</Text>
          </View>
        ) : null}
        {status.kind === 'error' ? (
          <View className="flex-row items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <Icon as={CircleAlert} size={16} className="mt-0.5 text-destructive" />
            <Text className="flex-1 text-sm leading-5 text-destructive">{status.text}</Text>
          </View>
        ) : null}

        <Text className="px-1 text-xs leading-5 text-muted-foreground">
          导入是幂等合并：重复导入同一批次不会产生重复数据。本机仅做离线研判，不含 AI 与任何密钥。
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
