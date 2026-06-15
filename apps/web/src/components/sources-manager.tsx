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

export type SourcePlatform = 'reddit' | 'hackernews' | 'rss';

/** 采集来源（与 server SourceRow 对应，UI 只用这些字段） */
export interface SourceDTO {
  id: number;
  platform: SourcePlatform;
  identifier: string;
  label: string;
  enabled: boolean;
}

/** 脱敏连接器（与 server ConnectorDTO 对应） */
export interface ConnectorDTO {
  id: number;
  platform: SourcePlatform;
  label: string;
  authKind: 'oauth' | 'scrape';
  enabled: boolean;
  priority: number;
  summary: string;
  lastCheckOk: boolean | null;
  lastCheckAt: number | null;
  lastCheckError: string | null;
}

export interface SourcesData {
  sources: SourceDTO[];
  connectors: ConnectorDTO[];
  redditUsable: boolean;
  secretConfigured: boolean;
}

const PLATFORM_LABEL: Record<SourcePlatform, string> = {
  reddit: 'Reddit',
  hackernews: 'HackerNews',
  rss: 'RSS',
};

const PLATFORM_PLACEHOLDER: Record<SourcePlatform, string> = {
  reddit: '版块名（不含 r/），如 startups',
  hackernews: '端点：topstories / askstories / showstories',
  rss: 'RSS feed 完整 URL',
};

interface Flash {
  kind: 'ok' | 'err';
  text: string;
}

interface ApiData {
  error?: string;
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

interface SourceForm {
  platform: SourcePlatform;
  identifier: string;
  label: string;
  enabled: boolean;
}

const EMPTY_SOURCE: SourceForm = { platform: 'reddit', identifier: '', label: '', enabled: true };

interface ConnForm {
  label: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
  priority: number;
}

const EMPTY_CONN: ConnForm = {
  label: '',
  clientId: '',
  clientSecret: '',
  username: '',
  password: '',
  userAgent: '',
  priority: 0,
};

/** 连接器测试状态徽标 */
function CheckBadge({ c }: { c: ConnectorDTO }) {
  if (c.lastCheckOk === true) return <Badge variant="secondary">测试通过</Badge>;
  if (c.lastCheckOk === false) return <Badge variant="destructive">测试失败</Badge>;
  return <Badge variant="outline">未测试</Badge>;
}

/**
 * 数据来源设置（客户端）：采集连接器（Reddit 凭据）增改/测试 + 爬虫计划勾选启用。
 * 全部经 web 的 /api/sources 与 /api/source-connectors 代理转发 server；凭据仅脱敏展示。
 * Reddit 门禁：无「可用 reddit 连接器」时其来源的启用开关置灰（服务端亦强制）。
 */
export function SourcesManager({
  initial,
  loadError,
}: {
  initial: SourcesData | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const [flash, setFlash] = useState<Flash | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  // 来源弹窗
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcEditingId, setSrcEditingId] = useState<number | null>(null);
  const [srcForm, setSrcForm] = useState<SourceForm>(EMPTY_SOURCE);
  const [srcBusy, setSrcBusy] = useState(false);
  // 连接器弹窗
  const [connOpen, setConnOpen] = useState(false);
  const [connEditingId, setConnEditingId] = useState<number | null>(null);
  const [connForm, setConnForm] = useState<ConnForm>(EMPTY_CONN);
  const [connBusy, setConnBusy] = useState(false);

  if (loadError || !initial) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {loadError ?? '加载失败'}
      </div>
    );
  }

  const { sources, connectors, redditUsable, secretConfigured } = initial;
  const platforms: SourcePlatform[] = ['reddit', 'hackernews', 'rss'];

  // ── 来源操作 ────────────────────────────────────────────────────────

  function openAddSource() {
    setSrcEditingId(null);
    setSrcForm(EMPTY_SOURCE);
    setSrcOpen(true);
  }

  function openEditSource(s: SourceDTO) {
    setSrcEditingId(s.id);
    setSrcForm({
      platform: s.platform,
      identifier: s.identifier,
      label: s.label,
      enabled: s.enabled,
    });
    setSrcOpen(true);
  }

  async function saveSource() {
    if (!srcForm.identifier.trim()) {
      setFlash({ kind: 'err', text: '标识不能为空' });
      return;
    }
    setSrcBusy(true);
    const body: Record<string, unknown> = {
      identifier: srcForm.identifier.trim(),
      label: srcForm.label.trim() || undefined,
      enabled: srcForm.enabled,
    };
    if (srcEditingId === null) body.platform = srcForm.platform;
    const res =
      srcEditingId === null
        ? await apiSend('/api/sources', 'POST', body)
        : await apiSend(`/api/sources/${srcEditingId}`, 'PUT', body);
    setSrcBusy(false);
    if (res.ok) {
      setSrcOpen(false);
      setFlash({ kind: 'ok', text: srcEditingId === null ? '已新增来源' : '已更新来源' });
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? `保存失败（${res.status}）` });
    }
  }

  async function toggleSource(s: SourceDTO) {
    const res = await apiSend(`/api/sources/${s.id}`, 'PUT', { enabled: !s.enabled });
    if (res.ok) router.refresh();
    else setFlash({ kind: 'err', text: res.data?.error ?? '操作失败' });
  }

  async function removeSource(s: SourceDTO) {
    if (!window.confirm(`删除来源「${s.label || s.identifier}」？`)) return;
    const res = await apiSend(`/api/sources/${s.id}`, 'DELETE');
    if (res.ok) {
      setFlash({ kind: 'ok', text: '已删除来源' });
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? '删除失败' });
    }
  }

  // ── 连接器操作 ──────────────────────────────────────────────────────

  function openAddConn() {
    setConnEditingId(null);
    setConnForm(EMPTY_CONN);
    setConnOpen(true);
  }

  function openEditConn(c: ConnectorDTO) {
    setConnEditingId(c.id);
    setConnForm({ ...EMPTY_CONN, label: c.label, priority: c.priority });
    setConnOpen(true);
  }

  async function saveConn() {
    setConnBusy(true);
    let res;
    if (connEditingId === null) {
      const missing = ['clientId', 'clientSecret', 'username', 'password', 'userAgent'].filter(
        (k) => !connForm[k as keyof ConnForm],
      );
      if (missing.length > 0) {
        setConnBusy(false);
        setFlash({ kind: 'err', text: `Reddit 凭据缺少：${missing.join(' / ')}` });
        return;
      }
      res = await apiSend('/api/source-connectors', 'POST', {
        platform: 'reddit',
        authKind: 'oauth',
        label: connForm.label.trim() || undefined,
        priority: connForm.priority,
        secret: {
          clientId: connForm.clientId.trim(),
          clientSecret: connForm.clientSecret.trim(),
          username: connForm.username.trim(),
          password: connForm.password,
          userAgent: connForm.userAgent.trim(),
        },
      });
    } else {
      // 编辑只改备注/优先级；改凭据请删除后重建
      res = await apiSend(`/api/source-connectors/${connEditingId}`, 'PUT', {
        label: connForm.label.trim(),
        priority: connForm.priority,
      });
    }
    setConnBusy(false);
    if (res.ok) {
      setConnOpen(false);
      setFlash({
        kind: 'ok',
        text:
          connEditingId === null
            ? '已新增连接器，请点「测试」通过后方可启用其来源'
            : '已更新连接器',
      });
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? `保存失败（${res.status}）` });
    }
  }

  async function toggleConn(c: ConnectorDTO) {
    const res = await apiSend(`/api/source-connectors/${c.id}`, 'PUT', { enabled: !c.enabled });
    if (res.ok) router.refresh();
    else setFlash({ kind: 'err', text: res.data?.error ?? '操作失败' });
  }

  async function removeConn(c: ConnectorDTO) {
    if (!window.confirm(`删除连接器「${c.label || c.summary}」？`)) return;
    const res = await apiSend(`/api/source-connectors/${c.id}`, 'DELETE');
    if (res.ok) {
      setFlash({ kind: 'ok', text: '已删除连接器' });
      router.refresh();
    } else {
      setFlash({ kind: 'err', text: res.data?.error ?? '删除失败' });
    }
  }

  async function testConn(c: ConnectorDTO) {
    setTestingId(c.id);
    const res = await apiSend(`/api/source-connectors/${c.id}/test`, 'POST');
    setTestingId(null);
    if (res.ok && res.data?.ok) {
      setFlash({ kind: 'ok', text: `连接器「${c.label || c.summary}」测试通过` });
    } else {
      setFlash({ kind: 'err', text: `测试失败：${res.data?.error ?? res.status}` });
    }
    router.refresh();
  }

  return (
    <section className="mt-10">
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">数据来源</h2>
        <p className="text-sm text-muted-foreground">
          监控哪些来源走数据表勾选；Reddit
          采集凭据在「采集连接器」配置并测试通过后，其来源才可启用。
        </p>
      </div>

      {flash ? (
        <p
          className={`mb-3 text-sm ${flash.kind === 'ok' ? 'text-foreground' : 'text-destructive'}`}
        >
          {flash.text}
        </p>
      ) : null}

      {/* 采集连接器 */}
      <div className="mb-6 rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <span className="font-medium">采集连接器</span>
          <Button variant="outline" size="sm" disabled={!secretConfigured} onClick={openAddConn}>
            新建连接器
          </Button>
        </div>
        <div className="p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            ⚠️ Reddit 官方 API 有作废风险（停发免费 key、起诉爬虫）；爬虫方案见
            <code className="font-mono"> docs/runtime-config-design.md §1.3</code>。
          </p>
          {connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有连接器。Reddit 来源需先在此配置 OAuth 凭据并测试通过。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">启用</TableHead>
                    <TableHead>平台</TableHead>
                    <TableHead>凭据</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connectors.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Switch checked={c.enabled} onCheckedChange={() => toggleConn(c)} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{PLATFORM_LABEL[c.platform]}</Badge>
                        {c.label ? <span className="ml-2 text-sm">{c.label}</span> : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.summary}
                        {c.lastCheckOk === false && c.lastCheckError ? (
                          <span className="block text-destructive">{c.lastCheckError}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <CheckBadge c={c} />
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={testingId === c.id}
                          onClick={() => testConn(c)}
                        >
                          {testingId === c.id ? '测试中…' : '测试'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEditConn(c)}>
                          编辑
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => removeConn(c)}>
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

      {/* 爬虫计划 */}
      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <span className="font-medium">爬虫计划（勾选启用）</span>
          <Button variant="outline" size="sm" onClick={openAddSource}>
            新建来源
          </Button>
        </div>
        <div className="space-y-4 p-3">
          {platforms.map((platform) => {
            const group = sources.filter((s) => s.platform === platform);
            const redditBlocked = platform === 'reddit' && !redditUsable;
            return (
              <div key={platform}>
                <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                  {PLATFORM_LABEL[platform]}
                  {redditBlocked ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      （无可用 Reddit 连接器，先去上方配置并测试通过）
                    </span>
                  ) : null}
                </div>
                {group.length === 0 ? (
                  <p className="text-sm text-muted-foreground">无</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableBody>
                        {group.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="w-16">
                              <Switch
                                checked={s.enabled}
                                disabled={redditBlocked && !s.enabled}
                                onCheckedChange={() => toggleSource(s)}
                                aria-label={s.enabled ? '停用' : '启用'}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{s.label || s.identifier}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {s.identifier}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Button variant="ghost" size="sm" onClick={() => openEditSource(s)}>
                                编辑
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => removeSource(s)}>
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
            );
          })}
        </div>
      </div>

      {/* 来源弹窗 */}
      <Dialog open={srcOpen} onOpenChange={setSrcOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{srcEditingId === null ? '新建来源' : '编辑来源'}</DialogTitle>
            <DialogDescription>一行 = 一个轮询目标；启用后纳入定时抓取。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {srcEditingId === null ? (
              <div className="space-y-1.5">
                <Label>平台</Label>
                <Select
                  value={srcForm.platform}
                  onValueChange={(v) =>
                    setSrcForm((f) => ({ ...f, platform: v as SourcePlatform, enabled: true }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reddit">Reddit</SelectItem>
                    <SelectItem value="hackernews">HackerNews</SelectItem>
                    <SelectItem value="rss">RSS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="src-id">标识</Label>
              <Input
                id="src-id"
                value={srcForm.identifier}
                onChange={(e) => setSrcForm((f) => ({ ...f, identifier: e.target.value }))}
                placeholder={PLATFORM_PLACEHOLDER[srcForm.platform]}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="src-label">展示名（可选）</Label>
              <Input
                id="src-label"
                value={srcForm.label}
                onChange={(e) => setSrcForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="如 ask_hn / techcrunch"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="src-enabled"
                checked={srcForm.enabled}
                disabled={srcForm.platform === 'reddit' && !redditUsable}
                onCheckedChange={(v) => setSrcForm((f) => ({ ...f, enabled: v }))}
              />
              <Label htmlFor="src-enabled">启用</Label>
              {srcForm.platform === 'reddit' && !redditUsable ? (
                <span className="text-xs text-muted-foreground">
                  需先配置并测试通过 Reddit 连接器
                </span>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSrcOpen(false)} disabled={srcBusy}>
              取消
            </Button>
            <Button onClick={saveSource} disabled={srcBusy}>
              {srcBusy ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 连接器弹窗 */}
      <Dialog open={connOpen} onOpenChange={setConnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {connEditingId === null ? '新建 Reddit 连接器' : '编辑连接器'}
            </DialogTitle>
            <DialogDescription>
              {connEditingId === null
                ? '填 Reddit OAuth 凭据（加密入库）。保存后点「测试」通过，才能启用 Reddit 来源。'
                : '凭据不可改（如需换凭据请删除后重建）；这里只改备注与优先级。'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="conn-label">备注（可选）</Label>
              <Input
                id="conn-label"
                value={connForm.label}
                onChange={(e) => setConnForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="如 主账号"
              />
            </div>
            {connEditingId === null ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="conn-cid">Client ID</Label>
                  <Input
                    id="conn-cid"
                    value={connForm.clientId}
                    onChange={(e) => setConnForm((f) => ({ ...f, clientId: e.target.value }))}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conn-secret">Client Secret</Label>
                  <Input
                    id="conn-secret"
                    type="password"
                    value={connForm.clientSecret}
                    onChange={(e) => setConnForm((f) => ({ ...f, clientSecret: e.target.value }))}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conn-user">用户名</Label>
                  <Input
                    id="conn-user"
                    value={connForm.username}
                    onChange={(e) => setConnForm((f) => ({ ...f, username: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conn-pass">密码</Label>
                  <Input
                    id="conn-pass"
                    type="password"
                    value={connForm.password}
                    onChange={(e) => setConnForm((f) => ({ ...f, password: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conn-ua">User-Agent</Label>
                  <Input
                    id="conn-ua"
                    value={connForm.userAgent}
                    onChange={(e) => setConnForm((f) => ({ ...f, userAgent: e.target.value }))}
                    placeholder="hatch-radar/1.0 (by /u/yourname)"
                    className="font-mono"
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="conn-priority">优先级（多连接器时越小越先用）</Label>
              <Input
                id="conn-priority"
                type="number"
                min={0}
                value={connForm.priority}
                onChange={(e) =>
                  setConnForm((f) => ({ ...f, priority: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConnOpen(false)} disabled={connBusy}>
              取消
            </Button>
            <Button onClick={saveConn} disabled={connBusy}>
              {connBusy ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
