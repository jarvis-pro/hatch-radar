'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hatch-radar/ui/components/button';
import { AnalyzeRow } from '@/components/analyze-row';

/** 工作台单条帖子（page 从 AwaitingPost 投影出的可序列化字段） */
export interface WorkbenchItem {
  id: string;
  title: string;
  channel: string;
  kind: 'pending' | 'restale';
  exportLocked: boolean;
}

/**
 * 闭环工作台列表（客户端）：多选帖子 → 「导出选中」一键冻结 + 逐篇下载 .md。
 * 冻结经 /api/export-lock 转发 server；文档复用 /api/doc。各行内仍可单独复制/粘回。
 */
export function AnalyzeWorkbench({ items }: { items: WorkbenchItem[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const lock = await fetch('/api/export-lock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postIds: ids }),
      });
      if (!lock.ok) {
        const e = (await lock.json().catch(() => null)) as { error?: string } | null;
        setMsg(e?.error ?? `冻结失败（${lock.status}）`);
        return;
      }
      let ok = 0;
      for (const id of ids) {
        const resp = await fetch(`/api/doc?postId=${encodeURIComponent(id)}`);
        if (!resp.ok) continue;
        const url = URL.createObjectURL(new Blob([await resp.text()], { type: 'text/markdown' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${id}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        ok++;
      }
      setMsg(`已导出 ${ok}/${ids.length} 篇并冻结；分析后粘回结果即自动解冻`);
      setSelected(new Set());
      router.refresh();
    } catch {
      setMsg('导出失败：无法连接工作台');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-8 items-center gap-3">
        <Button size="sm" onClick={exportSelected} disabled={busy || selected.size === 0}>
          {busy ? '导出中…' : `导出选中（${selected.size}）`}
        </Button>
        {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
      </div>
      {items.map((it) => (
        <AnalyzeRow
          key={it.id}
          postId={it.id}
          title={it.title}
          channel={it.channel}
          kind={it.kind}
          exportLocked={it.exportLocked}
          selected={selected.has(it.id)}
          onToggle={() => toggle(it.id)}
        />
      ))}
    </div>
  );
}
