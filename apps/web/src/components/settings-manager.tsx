'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { Switch } from '@hatch-radar/ui/components/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';

/** 模型厂商 */
export type ProviderKind = 'anthropic' | 'openai' | 'deepseek';

/** 脱敏模型配置（与 server ProviderDTO 对应） */
export interface ProviderDTO {
  id: number;
  provider: ProviderKind;
  label: string;
  model: string;
  baseUrl: string | null;
  enabled: boolean;
  hasKey: boolean;
  keyMasked: string;
  createdAt: number;
  updatedAt: number;
}

/** 设置页初始数据（来自 server /api/settings） */
export interface SettingsData {
  providers: ProviderDTO[];
  activeProviderId: number | null;
  secretConfigured: boolean;
}

const PROVIDER_DEFAULTS: Record<ProviderKind, { model: string; baseUrl: string }> = {
  anthropic: { model: 'claude-opus-4-8', baseUrl: '' },
  openai: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  deepseek: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
};

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (ChatGPT)',
  deepseek: 'DeepSeek',
};

interface FormState {
  provider: ProviderKind;
  label: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  provider: 'anthropic',
  label: '',
  apiKey: '',
  model: PROVIDER_DEFAULTS.anthropic.model,
  baseUrl: PROVIDER_DEFAULTS.anthropic.baseUrl,
  enabled: true,
};

interface Flash {
  kind: 'ok' | 'err';
  text: string;
}

interface ApiData {
  error?: string;
  enqueued?: number;
  ok?: boolean;
  id?: number;
}

async function apiSend(
  url: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: ApiData | null }> {
  const resp = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await resp.json().catch(() => null)) as ApiData | null;
  return { ok: resp.ok, status: resp.status, data };
}

/**
 * 模型设置（客户端）：模型清单 CRUD + 选用 active + 测试连通。
 * 全部经 web 的 /api/settings 代理转发 server；密钥仅脱敏展示，明文绝不回传浏览器。
 */
export function SettingsManager({
  initial,
  loadError,
}: {
  initial: SettingsData | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const [flash, setFlash] = useState<Flash | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  if (loadError || !initial) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {loadError ?? '加载失败'}
      </div>
    );
  }

  const { providers, activeProviderId, secretConfigured } = initial;
  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null;

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(p: ProviderDTO) {
    setEditingId(p.id);
    setForm({
      provider: p.provider,
      label: p.label,
      apiKey: '',
      model: p.model,
      baseUrl: p.baseUrl ?? '',
      enabled: p.enabled,
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

  async function save() {
    if (!form.label.trim() || !form.model.trim()) {
      setFlash({ kind: 'err', text: '名称与模型不能为空' });
      return;
    }
    if (editingId === null && !form.apiKey.trim()) {
      setFlash({ kind: 'err', text: '新增模型必须填写 API Key' });
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      provider: form.provider,
      label: form.label.trim(),
      model: form.model.trim(),
      baseUrl: form.baseUrl.trim() || undefined,
      enabled: form.enabled,
    };
    if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
    const res =
      editingId === null
        ? await apiSend('/api/settings/providers', 'POST', body)
        : await apiSend(`/api/settings/providers/${editingId}`, 'PUT', body);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setFlash({ kind: 'ok', text: editingId === null ? '已新增模型' : '已更新模型' });
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? `保存失败（${res.status}）` });
    }
  }

  async function remove(p: ProviderDTO) {
    if (!window.confirm(`删除模型「${p.label}」？`)) return;
    const res = await apiSend(`/api/settings/providers/${p.id}`, 'DELETE');
    if (res.ok) {
      setFlash({ kind: 'ok', text: '已删除' });
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? '删除失败' });
    }
  }

  async function toggleEnabled(p: ProviderDTO) {
    const res = await apiSend(`/api/settings/providers/${p.id}`, 'PUT', { enabled: !p.enabled });
    if (res.ok) {
      setFlash({ kind: 'ok', text: p.enabled ? '已停用' : '已启用' });
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? '操作失败' });
    }
  }

  async function setActive(id: number | null) {
    const res = await apiSend('/api/settings/active', 'PUT', { providerId: id });
    if (res.ok) {
      setFlash({
        kind: 'ok',
        text:
          id === null ? '已停用自动分析' : `已设为当前模型，即时入队 ${res.data?.enqueued ?? 0} 篇`,
      });
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? '操作失败' });
    }
  }

  async function test(p: ProviderDTO) {
    setTestingId(p.id);
    const res = await apiSend(`/api/settings/providers/${p.id}/test`, 'POST');
    setTestingId(null);
    if (res.ok && res.data?.ok) {
      setFlash({ kind: 'ok', text: `「${p.label}」连接正常` });
    } else {
      setFlash({ kind: 'err', text: `「${p.label}」连接失败：${res.data?.error ?? res.status}` });
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">模型设置</h1>
          <p className="text-sm text-muted-foreground">
            配置 Anthropic / OpenAI / DeepSeek，选用其一即自动分析；保存即生效，无需重启。
          </p>
        </div>
        <Button onClick={openCreate} disabled={!secretConfigured}>
          新增模型
        </Button>
      </div>

      {flash ? (
        <p
          className={`mb-3 text-sm ${flash.kind === 'ok' ? 'text-foreground' : 'text-destructive'}`}
        >
          {flash.text}
        </p>
      ) : null}

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

      {providers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          还没有配置任何模型。点击右上角「新增模型」添加一个。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">启用</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>厂商</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>密钥</TableHead>
                <TableHead>当前</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Switch
                      checked={p.enabled}
                      onCheckedChange={() => toggleEnabled(p)}
                      aria-label={p.enabled ? '停用' : '启用'}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{p.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{PROVIDER_LABEL[p.provider]}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.model}
                    {p.baseUrl ? (
                      <span className="block text-muted-foreground">{p.baseUrl}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.keyMasked}
                  </TableCell>
                  <TableCell>
                    {activeProviderId === p.id ? (
                      <Badge>当前</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!p.enabled}
                        onClick={() => setActive(p.id)}
                      >
                        设为当前
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
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
                    <Button variant="ghost" size="sm" onClick={() => remove(p)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId === null ? '新增模型' : '编辑模型'}</DialogTitle>
            <DialogDescription>
              密钥经 server 加密入库，浏览器只展示脱敏值；编辑时密钥留空表示保留原值。
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
                  <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                  <SelectItem value="deepseek">{PROVIDER_LABEL.deepseek}</SelectItem>
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

            <div className="space-y-1.5">
              <Label htmlFor="sm-key">API Key</Label>
              <Input
                id="sm-key"
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder={editingId === null ? '填写 API Key' : '留空保留原密钥'}
                className="font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sm-model">模型 ID</Label>
              <Input
                id="sm-model"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className="font-mono"
              />
            </div>

            {form.provider !== 'anthropic' ? (
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
    </>
  );
}
