import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@hatch-radar/ui/components/alert-dialog';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@hatch-radar/ui/components/dialog';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { Switch } from '@hatch-radar/ui/components/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { toast } from '@hatch-radar/ui/components/sonner';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api, ApiError } from '@/api/client';
import { EmptyState, LoadError } from '@/components/empty';
import { useTranslationUsage } from '@/translation/post-translation';

/** 模型厂商（claude_cli = Claude 订阅模式，复用本机已登录的 claude，无 API Key；azure = Azure Translator 机翻，仅翻译用） */
export type ProviderKind = 'anthropic' | 'openai' | 'deepseek' | 'claude_cli' | 'azure';

/** API Key 运行期健康态 */
export type ApiKeyStatus = 'active' | 'cooling' | 'invalid';

/** 脱敏的单把 Key（与 server ProviderKeyDTO 对应） */
export interface ProviderKeyDTO {
  id: number;
  label: string;
  priority: number;
  enabled: boolean;
  status: ApiKeyStatus;
  keyMasked: string;
  cooldownUntil: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 脱敏模型配置（与 server ProviderDTO 对应） */
export interface ProviderDTO {
  id: number;
  provider: ProviderKind;
  label: string;
  model: string;
  baseUrl: string | null;
  /** Azure Translator 资源区域；仅 azure 非空 */
  region: string | null;
  enabled: boolean;
  /** 输入 token 单价（$ /1M），未配置为 null */
  inputPrice: number | null;
  /** 输出 token 单价（$ /1M），未配置为 null */
  outputPrice: number | null;
  keys: ProviderKeyDTO[];
  createdAt: number;
  updatedAt: number;
}

/** 设置页初始数据（来自 server /api/settings） */
export interface SettingsData {
  providers: ProviderDTO[];
  activeProviderId: number | null;
  /** 默认翻译模型 id（与分析 active 解耦；null=回落 active provider） */
  translationProviderId: number | null;
  secretConfigured: boolean;
}

/** Azure 机翻当月用量条：免费档配额安全阀（超过即进入收费，标红提示）。 */
function AzureUsageMeter() {
  const usageQ = useTranslationUsage();
  const u = usageQ.data;
  if (!u) return null;
  const pct =
    u.azureFreeLimit > 0
      ? Math.min(100, Math.round((u.azureCharsThisMonth / u.azureFreeLimit) * 100))
      : 0;
  const over = u.azureCharsThisMonth >= u.azureFreeLimit;
  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Azure 机翻本月用量</span>
        <span className={cn('tabular-nums', over && 'text-destructive')}>
          {u.azureCharsThisMonth.toLocaleString()} / {u.azureFreeLimit.toLocaleString()} 字符
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full', over ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const PROVIDER_DEFAULTS: Record<ProviderKind, { model: string; baseUrl: string }> = {
  anthropic: { model: 'claude-opus-4-8', baseUrl: '' },
  openai: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  deepseek: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  claude_cli: { model: 'claude-opus-4-8', baseUrl: '' },
  azure: { model: 'azure-translator', baseUrl: '' },
};

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (ChatGPT)',
  deepseek: 'DeepSeek',
  claude_cli: 'Claude（订阅 / Claude Code）',
  azure: 'Azure Translator（机翻）',
};

/** 订阅模式（claude_cli）复用本机已登录的 claude：无需 API Key、无 base 地址、无 Key 池 */
function usesApiKey(p: ProviderKind): boolean {
  return p !== 'claude_cli';
}

/** 仅 OpenAI / DeepSeek 暴露自定义 API 基地址 */
function usesBaseUrl(p: ProviderKind): boolean {
  return p === 'openai' || p === 'deepseek';
}

interface FormState {
  provider: ProviderKind;
  label: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Azure 区域（Ocp-Apim-Subscription-Region）；仅 azure 用 */
  region: string;
  enabled: boolean;
  /** token 单价（$ /1M），字符串便于输入；空串=不设 */
  inputPrice: string;
  outputPrice: string;
}

const EMPTY_FORM: FormState = {
  provider: 'anthropic',
  label: '',
  apiKey: '',
  model: PROVIDER_DEFAULTS.anthropic.model,
  baseUrl: PROVIDER_DEFAULTS.anthropic.baseUrl,
  region: '',
  enabled: true,
  inputPrice: '',
  outputPrice: '',
};

interface KeyFormState {
  apiKey: string;
  label: string;
  priority: number;
}

const EMPTY_KEY_FORM: KeyFormState = { apiKey: '', label: '', priority: 0 };

/**
 * 受控确认弹窗：
 * - rebaseClear：编辑模型时改了 base 地址，保存会清空该模型现有全部 Key（高危，二次确认）
 * - deleteProvider：删除模型及其全部 Key
 * - deleteKey：删除单把 Key
 */
type Confirm =
  | { kind: 'rebaseClear' }
  | { kind: 'deleteProvider'; provider: ProviderDTO }
  | { kind: 'deleteKey'; providerId: number; k: ProviderKeyDTO };

interface ApiData {
  error?: string;
  enqueued?: number;
  ok?: boolean;
  id?: number;
}

/** 经同源 API 客户端发起请求（自带 cookie + CSRF 头；401 触发全局跳登录）。 */
async function apiSend(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: ApiData | null }> {
  const p = path.replace(/^\/api/, ''); // api 客户端再补 /api 前缀
  try {
    let data: ApiData | undefined;
    if (method === 'GET') data = await api.get<ApiData>(p);
    else if (method === 'POST') data = await api.post<ApiData>(p, body);
    else if (method === 'PUT') data = await api.put<ApiData>(p, body);
    else data = await api.del<ApiData>(p, body);
    return { ok: true, status: 200, data: data ?? {} };
  } catch (err) {
    if (err instanceof ApiError)
      return { ok: false, status: err.status, data: { error: err.message } };
    return { ok: false, status: 0, data: { error: '网络错误' } };
  }
}

/** 一把 Key 的状态徽标（含冷却剩余时间） */
function KeyStatusBadge({ k, now }: { k: ProviderKeyDTO; now: number }) {
  if (!k.enabled) return <Badge variant="outline">已停用</Badge>;
  if (k.status === 'invalid') return <Badge variant="destructive">失效</Badge>;
  if (k.status === 'cooling') {
    const remain = k.cooldownUntil ? k.cooldownUntil - now : 0;
    return (
      <Badge variant="outline">{remain > 0 ? `冷却 ${Math.ceil(remain / 60)}m` : '待恢复'}</Badge>
    );
  }
  return <Badge variant="secondary">正常</Badge>;
}

/**
 * 模型设置：模型清单 CRUD + 每条模型的多 Key 池（增删改 / 测试 / 复位）+ 选用 active。
 * 同源直连 /api/settings（cookie + CSRF）；密钥仅脱敏展示，明文绝不回传浏览器。
 * 变更后调用 onChanged() 让页面重新拉取（替代原 router.refresh()）。
 */
export function SettingsManager({
  initial,
  loadError,
  onChanged,
}: {
  initial: SettingsData | null;
  loadError: string | null;
  onChanged: () => void;
}) {
  // 模型配置弹窗
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editOrigBaseUrl, setEditOrigBaseUrl] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  // Key 池弹窗
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyProviderId, setKeyProviderId] = useState<number | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null);
  const [keyForm, setKeyForm] = useState<KeyFormState>(EMPTY_KEY_FORM);
  const [keyBusy, setKeyBusy] = useState(false);
  const [testingKeyId, setTestingKeyId] = useState<number | null>(null);
  // 受控确认弹窗（删除 / 高危改 base）
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  if (loadError || !initial) {
    return <LoadError message={loadError ?? undefined} />;
  }

  const { providers, activeProviderId, translationProviderId, secretConfigured } = initial;
  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null;
  // 可作翻译档的模型（启用的 claude_cli / azure）；据此渲染「默认翻译模型」选择器与 Azure 用量条
  const translationCandidates = providers.filter(
    (p) => p.enabled && (p.provider === 'claude_cli' || p.provider === 'azure'),
  );
  const hasAzureTranslation = translationCandidates.some((p) => p.provider === 'azure');
  const now = Math.floor(Date.now() / 1000);
  // 编辑态下改了 baseUrl 才需重填 Key（安全闸）；新建态始终需要首把 Key。订阅模式无 Key，恒不需要。
  const baseUrlChanged = editingId !== null && form.baseUrl.trim() !== editOrigBaseUrl.trim();
  const needKeyOnSave = usesApiKey(form.provider) && (editingId === null || baseUrlChanged);

  function openCreate() {
    setEditingId(null);
    setEditOrigBaseUrl('');
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(p: ProviderDTO) {
    setEditingId(p.id);
    setEditOrigBaseUrl(p.baseUrl ?? '');
    setForm({
      provider: p.provider,
      label: p.label,
      apiKey: '',
      model: p.model,
      baseUrl: p.baseUrl ?? '',
      region: p.region ?? '',
      enabled: p.enabled,
      inputPrice: p.inputPrice != null ? String(p.inputPrice) : '',
      outputPrice: p.outputPrice != null ? String(p.outputPrice) : '',
    });
    setOpen(true);
  }

  function changeProvider(v: ProviderKind) {
    // 新建时切厂商顺带带出默认模型/网关；编辑时只换厂商，保留已填值
    setForm((f) =>
      editingId === null
        ? {
            ...f,
            provider: v,
            model: PROVIDER_DEFAULTS[v].model,
            baseUrl: PROVIDER_DEFAULTS[v].baseUrl,
          }
        : { ...f, provider: v },
    );
  }

  /** 真正落库的保存（校验通过、必要时已二次确认后调用） */
  async function doSave() {
    const ip = form.inputPrice.trim();
    const op = form.outputPrice.trim();
    setBusy(true);
    setConfirmBusy(true);
    const body: Record<string, unknown> = {
      provider: form.provider,
      label: form.label.trim(),
      model: form.model.trim(),
      baseUrl: form.baseUrl.trim() || undefined,
      region: form.provider === 'azure' ? form.region.trim() : undefined,
      enabled: form.enabled,
      inputPrice: ip === '' ? null : Number(ip),
      outputPrice: op === '' ? null : Number(op),
    };
    if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
    const res =
      editingId === null
        ? await apiSend('/api/settings/providers', 'POST', body)
        : await apiSend(`/api/settings/providers/${editingId}`, 'PUT', body);
    setBusy(false);
    setConfirmBusy(false);
    if (res.ok) {
      setOpen(false);
      setConfirm(null);
      toast.success(editingId === null ? '已新增模型' : '已更新模型');
      onChanged();
    } else {
      toast.error(res.data?.error ?? `保存失败（${res.status}）`);
    }
  }

  /** 校验后保存；改了 base 地址会清空旧 Key，先走二次确认 */
  function save() {
    if (!form.label.trim() || !form.model.trim()) {
      toast.error('名称与模型不能为空');
      return;
    }
    if (usesApiKey(form.provider) && !secretConfigured) {
      toast.error('未配置 SETTINGS_SECRET，无法保存带密钥的模型');
      return;
    }
    if (needKeyOnSave && !form.apiKey.trim()) {
      toast.error(
        editingId === null ? '新增模型必须填写首把 API Key' : '修改 base 地址必须重填 API Key',
      );
      return;
    }
    const ip = form.inputPrice.trim();
    const op = form.outputPrice.trim();
    if ((ip !== '' && !(Number(ip) >= 0)) || (op !== '' && !(Number(op) >= 0))) {
      toast.error('token 单价需为非负数');
      return;
    }
    if (baseUrlChanged) {
      setConfirm({ kind: 'rebaseClear' });
      return;
    }
    void doSave();
  }

  async function removeProvider(p: ProviderDTO) {
    setConfirmBusy(true);
    const res = await apiSend(`/api/settings/providers/${p.id}`, 'DELETE');
    setConfirmBusy(false);
    if (res.ok) {
      setConfirm(null);
      toast.success('已删除');
      onChanged();
    } else {
      toast.error(res.data?.error ?? '删除失败');
    }
  }

  async function toggleEnabled(p: ProviderDTO) {
    const res = await apiSend(`/api/settings/providers/${p.id}`, 'PUT', { enabled: !p.enabled });
    if (res.ok) {
      toast.success(p.enabled ? '已停用' : '已启用');
      onChanged();
    } else {
      toast.error(res.data?.error ?? '操作失败');
    }
  }

  async function setActive(id: number | null) {
    const res = await apiSend('/api/settings/active', 'PUT', { providerId: id });
    if (res.ok) {
      toast.success(
        id === null ? '已停用自动分析' : `已设为当前模型，即时入队 ${res.data?.enqueued ?? 0} 篇`,
      );
      onChanged();
    } else {
      toast.error(res.data?.error ?? '操作失败');
    }
  }

  /** 设置（或清空）默认翻译模型；清空则翻译回落当前分析模型。 */
  async function setTranslationProvider(id: number | null) {
    const res = await apiSend('/api/settings/translation-provider', 'PUT', { providerId: id });
    if (res.ok) {
      toast.success(id === null ? '已清空（翻译回落当前分析模型）' : '已设为默认翻译模型');
      onChanged();
    } else {
      toast.error(res.data?.error ?? '操作失败');
    }
  }

  async function test(p: ProviderDTO) {
    setTestingId(p.id);
    const res = await apiSend(`/api/settings/providers/${p.id}/test`, 'POST');
    setTestingId(null);
    if (res.ok && res.data?.ok) {
      toast.success(`「${p.label}」连接正常`);
    } else {
      toast.error(`「${p.label}」连接失败：${res.data?.error ?? res.status}`);
    }
  }

  // ── Key 池操作 ──────────────────────────────────────────────────────

  function openAddKey(providerId: number) {
    setKeyProviderId(providerId);
    setEditingKeyId(null);
    setKeyForm(EMPTY_KEY_FORM);
    setKeyOpen(true);
  }

  function openEditKey(providerId: number, k: ProviderKeyDTO) {
    setKeyProviderId(providerId);
    setEditingKeyId(k.id);
    setKeyForm({ apiKey: '', label: k.label, priority: k.priority });
    setKeyOpen(true);
  }

  async function saveKey() {
    if (keyProviderId === null) return;
    if (editingKeyId === null && !keyForm.apiKey.trim()) {
      toast.error('请填写 API Key');
      return;
    }
    setKeyBusy(true);
    const res =
      editingKeyId === null
        ? await apiSend(`/api/settings/providers/${keyProviderId}/keys`, 'POST', {
            apiKey: keyForm.apiKey.trim(),
            label: keyForm.label.trim() || undefined,
            priority: keyForm.priority,
          })
        : await apiSend(`/api/settings/providers/${keyProviderId}/keys/${editingKeyId}`, 'PUT', {
            label: keyForm.label.trim(),
            priority: keyForm.priority,
          });
    setKeyBusy(false);
    if (res.ok) {
      setKeyOpen(false);
      toast.success(editingKeyId === null ? '已添加 Key' : '已更新 Key');
      onChanged();
    } else {
      toast.error(res.data?.error ?? `保存失败（${res.status}）`);
    }
  }

  async function removeKey(providerId: number, k: ProviderKeyDTO) {
    setConfirmBusy(true);
    const res = await apiSend(`/api/settings/providers/${providerId}/keys/${k.id}`, 'DELETE');
    setConfirmBusy(false);
    if (res.ok) {
      setConfirm(null);
      toast.success('已删除 Key');
      onChanged();
    } else {
      toast.error(res.data?.error ?? '删除失败');
    }
  }

  async function toggleKeyEnabled(providerId: number, k: ProviderKeyDTO) {
    const res = await apiSend(`/api/settings/providers/${providerId}/keys/${k.id}`, 'PUT', {
      enabled: !k.enabled,
    });
    if (res.ok) onChanged();
    else toast.error(res.data?.error ?? '操作失败');
  }

  async function resetKey(providerId: number, k: ProviderKeyDTO) {
    const res = await apiSend(`/api/settings/providers/${providerId}/keys/${k.id}`, 'PUT', {
      reset: true,
    });
    if (res.ok) {
      toast.success('已复位为可用');
      onChanged();
    } else {
      toast.error(res.data?.error ?? '操作失败');
    }
  }

  async function testKey(providerId: number, k: ProviderKeyDTO) {
    setTestingKeyId(k.id);
    const res = await apiSend(`/api/settings/providers/${providerId}/keys/${k.id}/test`, 'POST');
    setTestingKeyId(null);
    if (res.ok && res.data?.ok) toast.success(`Key「${k.label || k.keyMasked}」连接正常`);
    else toast.error(`Key 连接失败：${res.data?.error ?? res.status}`);
  }

  /** 执行受控确认弹窗里被确认的操作 */
  function runConfirm() {
    if (!confirm) return;
    if (confirm.kind === 'rebaseClear') void doSave();
    else if (confirm.kind === 'deleteProvider') void removeProvider(confirm.provider);
    else void removeKey(confirm.providerId, confirm.k);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">模型设置</h2>
          <p className="text-sm text-muted-foreground">
            配置 Anthropic / OpenAI / DeepSeek（API Key），或 Claude 订阅模式（复用本机已登录的
            Claude Code，无需 Key）；API Key
            模式每条可挂多把做故障转移，选用其一即自动分析，保存即生效。
          </p>
        </div>
        <Button onClick={openCreate}>新增模型</Button>
      </div>

      {!secretConfigured ? (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          未配置 <code className="font-mono">SETTINGS_SECRET</code>
          ：server 的 <code className="font-mono">.env</code>{' '}
          未设置加密主密钥，暂时无法保存模型密钥。设置后重启 server 即可（
          <code className="font-mono">openssl rand -hex 32</code>）。
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">当前自动分析模型：</span>
        {activeProvider ? (
          <>
            <Badge variant="secondary">{activeProvider.label}</Badge>
            <Button variant="ghost" size="sm" onClick={() => setActive(null)}>
              停用自动分析
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">
            未选用（不自动分析，仅可在「分析」页手动运行）
          </span>
        )}
      </div>

      {/* 默认翻译模型（与分析 active 解耦）：翻译只给人看、喂 AI 仍用原文，故优先 Azure 机翻走免费档省额度 */}
      <div className="mb-4 rounded-lg border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">默认翻译模型：</span>
          <Select
            value={translationProviderId != null ? String(translationProviderId) : 'none'}
            onValueChange={(v) => setTranslationProvider(v === 'none' ? null : Number(v))}
          >
            <SelectTrigger className="h-8 w-auto min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未指定（回落当前分析模型）</SelectItem>
              {translationCandidates.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.label}（{p.provider === 'azure' ? '机翻·免费走量' : '高质量·耗额度'}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          翻译只给人看（喂 AI 仍用原文），建议选 Azure
          机翻走免费档省订阅额度；个别重要内容可在帖子页临时用 Claude 高质量翻译。
        </p>
        {hasAzureTranslation ? <AzureUsageMeter /> : null}
      </div>

      {providers.length === 0 ? (
        <EmptyState
          title="还没有配置任何模型"
          hint="添加一个模型后即可选用它做自动分析。"
          action={<Button onClick={openCreate}>新增模型</Button>}
        />
      ) : (
        <div className="space-y-4">
          {providers.map((p) => (
            <div key={p.id} className="rounded-lg border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={() => toggleEnabled(p)}
                    aria-label={p.enabled ? '停用' : '启用'}
                  />
                  <span className="font-medium">{p.label}</span>
                  <Badge variant="outline">{PROVIDER_LABEL[p.provider]}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{p.model}</span>
                  {p.baseUrl ? (
                    <span className="font-mono text-xs text-muted-foreground">{p.baseUrl}</span>
                  ) : null}
                  {p.inputPrice != null || p.outputPrice != null ? (
                    <span className="text-xs text-muted-foreground">
                      单价 ${p.inputPrice ?? '?'} / ${p.outputPrice ?? '?'} /1M
                    </span>
                  ) : null}
                  {activeProviderId === p.id ? <Badge>当前</Badge> : null}
                </div>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  {activeProviderId === p.id ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!p.enabled}
                      onClick={() => setActive(p.id)}
                    >
                      设为当前
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={testingId === p.id}
                    onClick={() => test(p)}
                  >
                    {testingId === p.id ? '测试中…' : '测试'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirm({ kind: 'deleteProvider', provider: p })}
                  >
                    删除
                  </Button>
                </div>
              </div>

              <div className="p-3">
                {p.provider !== 'claude_cli' && p.provider !== 'azure' ? (
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      API Key 池（{p.keys.length}）
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!secretConfigured}
                      onClick={() => openAddKey(p.id)}
                    >
                      添加 Key
                    </Button>
                  </div>
                ) : null}
                {p.provider === 'claude_cli' ? (
                  <p className="text-sm text-muted-foreground">
                    订阅模式：复用本机已登录的 Claude（Claude Code），无需 API Key。
                  </p>
                ) : p.provider === 'azure' ? (
                  // 机翻免费档：单把 Key，不做多 Key 池故障转移；更换走「编辑」
                  p.keys.length === 0 ? (
                    <p className="text-sm text-destructive">
                      未配置 API Key，请用上方「编辑」设置一把 Azure 订阅 Key。
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">订阅 Key（单把）</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.keys[0].keyMasked}
                      </span>
                      <KeyStatusBadge k={p.keys[0]} now={now} />
                      {p.keys[0].status === 'invalid' && p.keys[0].lastError ? (
                        <span className="text-xs text-destructive">{p.keys[0].lastError}</span>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={testingKeyId === p.keys[0].id}
                        onClick={() => testKey(p.id, p.keys[0])}
                      >
                        {testingKeyId === p.keys[0].id ? '测试中…' : '测试'}
                      </Button>
                      {p.keys[0].status !== 'active' ? (
                        <Button variant="ghost" size="sm" onClick={() => resetKey(p.id, p.keys[0])}>
                          复位
                        </Button>
                      ) : null}
                      <span className="text-xs text-muted-foreground">更换请用「编辑」</span>
                    </div>
                  )
                ) : p.keys.length === 0 ? (
                  <p className="text-sm text-destructive">
                    无 Key，该模型无法调用——请添加至少一把。
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">优先级</TableHead>
                          <TableHead>备注</TableHead>
                          <TableHead>密钥</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="w-16">启用</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.keys.map((k) => (
                          <TableRow key={k.id}>
                            <TableCell className="font-mono text-xs">{k.priority}</TableCell>
                            <TableCell>{k.label || '—'}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {k.keyMasked}
                              {k.status === 'invalid' && k.lastError ? (
                                <span className="block text-destructive">{k.lastError}</span>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <KeyStatusBadge k={k} now={now} />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={k.enabled}
                                onCheckedChange={() => toggleKeyEnabled(p.id, k)}
                                aria-label={k.enabled ? '停用' : '启用'}
                              />
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={testingKeyId === k.id}
                                onClick={() => testKey(p.id, k)}
                              >
                                {testingKeyId === k.id ? '测试中…' : '测试'}
                              </Button>
                              {k.status !== 'active' ? (
                                <Button variant="ghost" size="sm" onClick={() => resetKey(p.id, k)}>
                                  复位
                                </Button>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditKey(p.id, k)}
                              >
                                编辑
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() =>
                                  setConfirm({ kind: 'deleteKey', providerId: p.id, k })
                                }
                              >
                                删除
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 模型配置弹窗 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId === null ? '新增模型' : '编辑模型'}</DialogTitle>
            <DialogDescription>
              密钥经 server 加密入库，浏览器只展示脱敏值。API Key
              的日常增删改请用每条模型下方的「Key 池」。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>厂商</Label>
              <Select
                value={form.provider}
                onValueChange={(v) => changeProvider(v as ProviderKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">{PROVIDER_LABEL.anthropic}</SelectItem>
                  <SelectItem value="claude_cli">{PROVIDER_LABEL.claude_cli}</SelectItem>
                  <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                  <SelectItem value="deepseek">{PROVIDER_LABEL.deepseek}</SelectItem>
                  <SelectItem value="azure">{PROVIDER_LABEL.azure}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sm-label">名称</Label>
              <Input
                id="sm-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="如 GPT-4o 生产"
              />
            </div>

            {form.provider !== 'azure' ? (
              <div className="space-y-1.5">
                <Label htmlFor="sm-model">模型 ID</Label>
                <Input
                  id="sm-model"
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  className="font-mono"
                />
              </div>
            ) : null}

            {form.provider === 'azure' ? (
              <div className="space-y-1.5">
                <Label htmlFor="sm-region">Azure 区域（Region）</Label>
                <Input
                  id="sm-region"
                  value={form.region}
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                  placeholder="区域代码，如 centralus / eastasia（非显示名 Central US）"
                  className="font-mono"
                />
              </div>
            ) : null}

            {usesBaseUrl(form.provider) ? (
              <div className="space-y-1.5">
                <Label htmlFor="sm-baseurl">API 基地址（可选）</Label>
                <Input
                  id="sm-baseurl"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder={PROVIDER_DEFAULTS[form.provider].baseUrl}
                  className="font-mono"
                />
              </div>
            ) : null}

            {form.provider !== 'azure' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sm-inprice">输入单价（$ /1M tokens，可选）</Label>
                  <Input
                    id="sm-inprice"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.inputPrice}
                    onChange={(e) => setForm((f) => ({ ...f, inputPrice: e.target.value }))}
                    placeholder="如 3"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sm-outprice">输出单价（$ /1M tokens，可选）</Label>
                  <Input
                    id="sm-outprice"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.outputPrice}
                    onChange={(e) => setForm((f) => ({ ...f, outputPrice: e.target.value }))}
                    placeholder="如 15"
                    className="font-mono"
                  />
                </div>
              </div>
            ) : null}

            {needKeyOnSave ? (
              <div className="space-y-1.5">
                <Label htmlFor="sm-key">
                  {editingId === null ? '首把 API Key' : '重填 API Key（改 base 地址需重填）'}
                </Label>
                <Input
                  id="sm-key"
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="填写 API Key"
                  className="font-mono"
                />
                {baseUrlChanged ? (
                  <p className="text-xs text-muted-foreground">
                    改 base 地址会清空该模型现有全部 Key，仅保留这把新填的。
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* azure 编辑态：单把 Key 在此可选更换（新建态走上面的「首把 API Key」） */}
            {form.provider === 'azure' && editingId !== null ? (
              <div className="space-y-1.5">
                <Label htmlFor="sm-azure-key">更换 API Key（留空不改）</Label>
                <Input
                  id="sm-azure-key"
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="仅在更换 Azure Key 时填写"
                  className="font-mono"
                />
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Switch
                id="sm-enabled"
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
              <Label htmlFor="sm-enabled">启用</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Key 池弹窗 */}
      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingKeyId === null ? '添加 API Key' : '编辑 API Key'}</DialogTitle>
            <DialogDescription>
              {editingKeyId === null
                ? '同一模型可挂多把 Key：调用时按优先级选可用的一把，限流/失效自动切换。'
                : '密钥本身不可改（如需换密钥请删除后重新添加）；这里只改备注与优先级。'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {editingKeyId === null ? (
              <div className="space-y-1.5">
                <Label htmlFor="kf-key">API Key</Label>
                <Input
                  id="kf-key"
                  type="password"
                  value={keyForm.apiKey}
                  onChange={(e) => setKeyForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="填写 API Key"
                  className="font-mono"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="kf-label">备注（可选）</Label>
              <Input
                id="kf-label"
                value={keyForm.label}
                onChange={(e) => setKeyForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="如 主号 / 备用1"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="kf-priority">优先级（越小越先用）</Label>
              <Input
                id="kf-priority"
                type="number"
                min={0}
                value={keyForm.priority}
                onChange={(e) =>
                  setKeyForm((f) => ({ ...f, priority: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setKeyOpen(false)} disabled={keyBusy}>
              取消
            </Button>
            <Button onClick={saveKey} disabled={keyBusy}>
              {keyBusy ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 受控确认弹窗：删除模型 / 删除 Key / 高危改 base 清空 Key */}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'rebaseClear'
                ? '改 base 地址会清空全部 Key'
                : confirm?.kind === 'deleteProvider'
                  ? '删除模型'
                  : confirm?.kind === 'deleteKey'
                    ? '删除 API Key'
                    : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'rebaseClear' ? (
                <>
                  你修改了该模型的 API 基地址。保存将
                  <span className="font-medium text-foreground">清空该模型现有的全部 Key</span>
                  ，仅保留这次新填的这把，且不可恢复。确定继续？
                </>
              ) : confirm?.kind === 'deleteProvider' ? (
                <>
                  将永久删除模型{' '}
                  <span className="font-medium text-foreground">{confirm.provider.label}</span>{' '}
                  及其全部 Key，且不可恢复。
                </>
              ) : confirm?.kind === 'deleteKey' ? (
                <>
                  将永久删除 Key{' '}
                  <span className="font-medium text-foreground">
                    {confirm.k.label || confirm.k.keyMasked}
                  </span>
                  ，且不可恢复。
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmBusy}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={confirmBusy}
              className="gap-2"
              onClick={runConfirm}
            >
              {confirmBusy ? <Spinner /> : null}
              {confirm?.kind === 'rebaseClear'
                ? '保存并清空 Key'
                : confirm?.kind === 'deleteProvider'
                  ? '删除模型'
                  : confirm?.kind === 'deleteKey'
                    ? '删除 Key'
                    : ''}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
