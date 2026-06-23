import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@hatch-radar/ui/components/collapsible';
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
import { api, ApiError } from '@/api/client';
import { EmptyState, LoadError } from '@/components/empty';

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

/** 受控确认弹窗：删除来源 / 删除连接器（均不可恢复） */
type Confirm =
  | { kind: 'deleteSource'; source: SourceDTO }
  | { kind: 'deleteConn'; conn: ConnectorDTO };

interface ApiData {
  error?: string;
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
    if (method === 'GET') {
      data = await api.get<ApiData>(p);
    } else if (method === 'POST') {
      data = await api.post<ApiData>(p, body);
    } else if (method === 'PUT') {
      data = await api.put<ApiData>(p, body);
    } else {
      data = await api.del<ApiData>(p, body);
    }

    return { ok: true, status: 200, data: data ?? {} };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, status: err.status, data: { error: err.message } };
    }

    return { ok: false, status: 0, data: { error: '网络错误' } };
  }
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
  if (c.lastCheckOk === true) {
    return <Badge variant="secondary">测试通过</Badge>;
  }

  if (c.lastCheckOk === false) {
    return <Badge variant="destructive">测试失败</Badge>;
  }

  return <Badge variant="outline">未测试</Badge>;
}

/**
 * 数据来源设置：采集连接器（Reddit 凭据）增改/测试 + 爬虫计划勾选启用。
 * 同源直连 /api/sources 与 /api/source-connectors（cookie + CSRF）；凭据仅脱敏展示。
 * Reddit 门禁：无「可用 reddit 连接器」时其来源的启用开关置灰（服务端亦强制）。
 */
export function SourcesManager({
  initial,
  loadError,
  onChanged,
}: {
  initial: SourcesData | null;
  loadError: string | null;
  onChanged: () => void;
}) {
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
  // 受控确认弹窗（删除来源 / 删除连接器）
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  if (loadError || !initial) {
    return <LoadError message={loadError ?? undefined} />;
  }

  const { sources, connectors, redditUsable, secretConfigured } = initial;
  // 未创建任何 Reddit 连接器前不展示 Reddit 爬虫计划（HackerNews / RSS 不受影响）；
  // 连接器一经创建即显示，未测通时其来源开关仍置灰（redditUsable 门禁）。
  const redditConfigured = connectors.some((c) => c.platform === 'reddit');
  const allPlatforms: SourcePlatform[] = ['reddit', 'hackernews', 'rss'];
  const platforms = allPlatforms.filter((p) => p !== 'reddit' || redditConfigured);

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
      toast.error('标识不能为空');

      return;
    }

    setSrcBusy(true);
    const body: Record<string, unknown> = {
      identifier: srcForm.identifier.trim(),
      label: srcForm.label.trim() || undefined,
      enabled: srcForm.enabled,
    };
    if (srcEditingId === null) {
      body.platform = srcForm.platform;
    }

    const res =
      srcEditingId === null
        ? await apiSend('/api/sources', 'POST', body)
        : await apiSend(`/api/sources/${srcEditingId}`, 'PUT', body);
    setSrcBusy(false);
    if (res.ok) {
      setSrcOpen(false);
      toast.success(srcEditingId === null ? '已新增来源' : '已更新来源');
      onChanged();
    } else {
      toast.error(res.data?.error ?? `保存失败（${res.status}）`);
    }
  }

  async function toggleSource(s: SourceDTO) {
    const res = await apiSend(`/api/sources/${s.id}`, 'PUT', { enabled: !s.enabled });
    if (res.ok) {
      onChanged();
    } else {
      toast.error(res.data?.error ?? '操作失败');
    }
  }

  async function removeSource(s: SourceDTO) {
    setConfirmBusy(true);
    const res = await apiSend(`/api/sources/${s.id}`, 'DELETE');
    setConfirmBusy(false);
    if (res.ok) {
      setConfirm(null);
      toast.success('已删除来源');
      onChanged();
    } else {
      toast.error(res.data?.error ?? '删除失败');
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
        toast.error(`Reddit 凭据缺少：${missing.join(' / ')}`);

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
      toast.success(
        connEditingId === null ? '已新增连接器，请点「测试」通过后方可启用其来源' : '已更新连接器',
      );
      onChanged();
    } else {
      toast.error(res.data?.error ?? `保存失败（${res.status}）`);
    }
  }

  async function toggleConn(c: ConnectorDTO) {
    const res = await apiSend(`/api/source-connectors/${c.id}`, 'PUT', { enabled: !c.enabled });
    if (res.ok) {
      onChanged();
    } else {
      toast.error(res.data?.error ?? '操作失败');
    }
  }

  async function removeConn(c: ConnectorDTO) {
    setConfirmBusy(true);
    const res = await apiSend(`/api/source-connectors/${c.id}`, 'DELETE');
    setConfirmBusy(false);
    if (res.ok) {
      setConfirm(null);
      toast.success('已删除连接器');
      onChanged();
    } else {
      toast.error(res.data?.error ?? '删除失败');
    }
  }

  async function testConn(c: ConnectorDTO) {
    setTestingId(c.id);
    const res = await apiSend(`/api/source-connectors/${c.id}/test`, 'POST');
    setTestingId(null);
    if (res.ok && res.data?.ok) {
      toast.success(`连接器「${c.label || c.summary}」测试通过`);
    } else {
      toast.error(`测试失败：${res.data?.error ?? res.status}`);
    }

    onChanged();
  }

  /** 执行受控确认弹窗里被确认的删除 */
  function runConfirm() {
    if (!confirm) {
      return;
    }

    if (confirm.kind === 'deleteSource') {
      void removeSource(confirm.source);
    } else {
      void removeConn(confirm.conn);
    }
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">数据来源</h2>
        <p className="text-sm text-muted-foreground">
          勾选要监控的来源即纳入定时抓取。HackerNews / RSS 开箱即用；Reddit 需配置采集连接器（官方
          API 已停用，当前多不可用）。
        </p>
      </div>

      {/* 数据来源（爬虫计划）—— 主区置顶；HackerNews / RSS 开箱即用 */}
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
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
                  {PLATFORM_LABEL[platform]}
                  {redditBlocked ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      · 连接器未测通，暂不可启用
                    </span>
                  ) : null}
                </div>
                {group.length === 0 ? (
                  <EmptyState title={`暂无 ${PLATFORM_LABEL[platform]} 来源`} />
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
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setConfirm({ kind: 'deleteSource', source: s })}
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
            );
          })}
        </div>
      </div>

      {/* 采集连接器 —— 降权：Reddit 官方 API 已停用，默认折叠收起，不占主视野 */}
      <Collapsible defaultOpen={connectors.length > 0} className="mt-6 rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            <span className="font-medium">采集连接器</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              Reddit 凭据 · 官方 API 已停用，当前非必填
            </span>
          </CollapsibleTrigger>
          <Button variant="outline" size="sm" disabled={!secretConfigured} onClick={openAddConn}>
            新建连接器
          </Button>
        </div>
        <CollapsibleContent className="space-y-3 border-t p-3">
          <p className="text-xs text-muted-foreground">
            Reddit 官方已停发免费 key
            并对爬虫采取法律行动；官方通道不可用时后续将切到爬虫方案。HackerNews / RSS 不受此影响。
          </p>
          {connectors.length === 0 ? (
            <EmptyState
              title="还没有连接器"
              hint="Reddit 来源需先在此配置 OAuth 凭据并测试通过后才能启用。"
              action={
                <Button size="sm" disabled={!secretConfigured} onClick={openAddConn}>
                  新建连接器
                </Button>
              }
            />
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirm({ kind: 'deleteConn', conn: c })}
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
        </CollapsibleContent>
      </Collapsible>

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

      {/* 受控确认弹窗：删除来源 / 删除连接器 */}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'deleteSource'
                ? '删除来源'
                : confirm?.kind === 'deleteConn'
                  ? '删除连接器'
                  : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'deleteSource' ? (
                <>
                  将永久删除来源{' '}
                  <span className="font-medium text-foreground">
                    {confirm.source.label || confirm.source.identifier}
                  </span>
                  ，且不可恢复。
                </>
              ) : confirm?.kind === 'deleteConn' ? (
                <>
                  将永久删除连接器{' '}
                  <span className="font-medium text-foreground">
                    {confirm.conn.label || confirm.conn.summary}
                  </span>
                  ，其下 Reddit 来源将随之不可用，且不可恢复。
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
              {confirm?.kind === 'deleteSource'
                ? '删除来源'
                : confirm?.kind === 'deleteConn'
                  ? '删除连接器'
                  : ''}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
