'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Checkbox } from '@hatch-radar/ui/components/checkbox';
import { Textarea } from '@hatch-radar/ui/components/textarea';

/** AnalyzeRow 组件 props */
export interface AnalyzeRowProps {
  /** 帖子 ID（回灌与取文档的键） */
  postId: string;
  /** 帖子标题 */
  title: string;
  /** 频道展示名（如 r/SaaS） */
  channel: string;
  /** pending=未回灌；restale=已回灌但评论又变（建议重判） */
  kind: 'pending' | 'restale';
  /** 是否处于导出冻结（已导出待回灌） */
  exportLocked: boolean;
  /** 多选是否选中 */
  selected: boolean;
  /** 切换选中 */
  onToggle: () => void;
}

interface Msg {
  kind: 'ok' | 'err';
  text: string;
}

/** /api/import 成功响应的关心字段 */
interface ImportResponse {
  outcome?: string;
  painPoints?: number;
  opportunities?: number;
  error?: string;
}

/**
 * 单条待处理帖子的操作行（客户端）：多选 + 复制待分析文档 + 粘贴回灌外部 AI 结果。
 * 复制与回灌均经 web 的代理 route handler 转发到 server 进程——web 不直接写库。
 */
export function AnalyzeRow({
  postId,
  title,
  channel,
  kind,
  exportLocked,
  selected,
  onToggle,
}: AnalyzeRowProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function copyDoc() {
    setMsg(null);
    try {
      const resp = await fetch(`/api/doc?postId=${encodeURIComponent(postId)}`);
      if (!resp.ok) {
        const err = (await resp.json().catch(() => null)) as { error?: string } | null;
        setMsg({ kind: 'err', text: `取文档失败：${err?.error ?? resp.status}` });
        return;
      }
      await navigator.clipboard.writeText(await resp.text());
      setMsg({ kind: 'ok', text: '待分析文档已复制，粘贴给外部 AI 即可' });
    } catch {
      setMsg({ kind: 'err', text: '复制失败（浏览器剪贴板不可用？）' });
    }
  }

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const resp = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, resultText: text }),
      });
      const data = (await resp.json().catch(() => null)) as ImportResponse | null;
      if (resp.ok && data?.outcome === 'imported') {
        setText('');
        setOpen(false);
        setMsg({
          kind: 'ok',
          text: `已回填：痛点 ${data.painPoints ?? 0} / 机会 ${data.opportunities ?? 0}`,
        });
        router.refresh();
      } else {
        setMsg({ kind: 'err', text: data?.error ?? `回填失败（${resp.status}）` });
      }
    } catch {
      setMsg({ kind: 'err', text: '提交失败：无法连接工作台' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle()}
          aria-label="选择此帖以批量导出"
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{channel}</span>
            {kind === 'restale' ? <Badge variant="secondary">评论已更新 · 建议重判</Badge> : null}
            {exportLocked ? <Badge variant="outline">已导出</Badge> : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={copyDoc}>
            复制文档
          </Button>
          <Button
            variant={open ? 'secondary' : 'default'}
            size="sm"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '收起' : '粘贴结果'}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="把外部 AI 返回的 JSON 粘贴到这里（可含 ```json 围栏或多余说明文字）"
            className="font-mono text-xs"
          />
          <Button size="sm" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? '回填中…' : '回填洞察'}
          </Button>
        </div>
      ) : null}

      {msg ? (
        <p
          className={
            msg.kind === 'ok' ? 'mt-2 text-xs text-foreground' : 'mt-2 text-xs text-destructive'
          }
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
