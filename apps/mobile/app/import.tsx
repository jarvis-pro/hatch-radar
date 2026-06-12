import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { ExportBatch } from '@hatch-radar/shared';
import { importBatch, importSqliteFile, type ImportResult } from '../src/db/import';
import {
  fetchBatch,
  fetchHealth,
  loadWorkstationConfig,
  normalizeBaseUrl,
  saveWorkstationConfig,
} from '../src/lib/workstation';

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

export default function ImportScreen() {
  const saved = loadWorkstationConfig();
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? '');
  const [token, setToken] = useState(saved?.token ?? '');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const busy = status.kind === 'busy';

  /** 统一的异步操作包装：忙态 + 错误兜底 */
  const run = async (label: string, fn: () => Promise<string>) => {
    setStatus({ kind: 'busy', label });
    try {
      setStatus({ kind: 'done', text: await fn() });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const cfgFromInputs = () => {
    const cfg = { baseUrl: normalizeBaseUrl(baseUrl), token: token.trim() || undefined };
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
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>局域网拉取</Text>
        <Text style={styles.hint}>
          回到工作台所在局域网（或连工作台热点），地址见 server 启动日志「局域网地址」。
        </Text>
        <TextInput
          style={styles.input}
          placeholder="http://192.168.0.95:8787"
          placeholderTextColor="#9aa3b2"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={baseUrl}
          onChangeText={setBaseUrl}
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          placeholder="访问令牌（工作台未设 EXPORT_TOKEN 则留空）"
          placeholderTextColor="#9aa3b2"
          autoCapitalize="none"
          autoCorrect={false}
          value={token}
          onChangeText={setToken}
          editable={!busy}
        />
        <View style={styles.btnRow}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onTest} disabled={busy}>
            <Text style={styles.btnGhostText}>测试连接</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onPull} disabled={busy}>
            <Text style={styles.btnPrimaryText}>拉取批次并导入</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>文件导入</Text>
        <Text style={styles.hint}>
          导入工作台 pnpm export:batch 产出、经 AirDrop / 文件 App 传来的 .sqlite 或 .json 批次。
        </Text>
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={onPickFile} disabled={busy}>
          <Text style={styles.btnGhostText}>选择批次文件…</Text>
        </Pressable>

        {status.kind === 'busy' ? (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.hint}>{status.label}</Text>
          </View>
        ) : null}
        {status.kind === 'done' ? <Text style={styles.done}>{status.text}</Text> : null}
        {status.kind === 'error' ? <Text style={styles.error}>{status.text}</Text> : null}

        <Text style={styles.footnote}>
          导入是幂等合并：重复导入同一批次不会产生重复数据。本机仅做离线研判，不含 AI 与任何密钥。
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1c2330', marginTop: 8 },
  hint: { fontSize: 12.5, color: '#6b7585', lineHeight: 18 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e7ee',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14.5,
    color: '#1c2330',
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#2563eb' },
  btnPrimaryText: { color: '#fff', fontSize: 14.5, fontWeight: '600' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee' },
  btnGhostText: { color: '#1c2330', fontSize: 14.5, fontWeight: '500' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  done: { fontSize: 13.5, color: '#059669', lineHeight: 19, marginTop: 4 },
  error: { fontSize: 13.5, color: '#dc2626', lineHeight: 19, marginTop: 4 },
  footnote: { fontSize: 12, color: '#9aa3b2', lineHeight: 17, marginTop: 16 },
});
