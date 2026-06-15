import { useState } from 'react';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { NativeSelect, NativeSelectOption } from '@hatch-radar/ui/components/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@hatch-radar/ui/components/popover';
import { ApiError, downloadBlob } from '@/api/client';

type Format = 'sqlite' | 'json';
type IntensityOpt = '' | 'MEDIUM' | 'HIGH';

/**
 * 「导出批次」入口（同源直连 /api/export/*）：按条件筛出有效数据，下载为 .sqlite / .json。
 * server 持密钥、复用同一套 sqlite-writer 生成产物；需 export:run 能力（守卫据会话校验）。
 */
export function ExportBatchButton({ subreddits }: { subreddits: string[] }) {
  const [format, setFormat] = useState<Format>('sqlite');
  const [days, setDays] = useState('');
  const [minIntensity, setMinIntensity] = useState<IntensityOpt>('');
  const [subreddit, setSubreddit] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      const d = Number(days);
      if (days && Number.isFinite(d) && d > 0) {
        // 「最近 N 天」→ since（Unix 秒），与 server parseExportFilter 对齐
        qs.set('since', String(Math.floor(Date.now() / 1000) - Math.round(d * 86400)));
      }
      if (minIntensity) qs.set('minIntensity', minIntensity);
      if (subreddit.trim()) qs.set('subreddit', subreddit.trim());
      const n = Number(limit);
      if (limit && Number.isInteger(n) && n > 0) qs.set('limit', String(n));

      const ts = Math.floor(Date.now() / 1000);
      const query = qs.toString() ? `?${qs.toString()}` : '';
      const path = format === 'sqlite' ? `/export/batch.sqlite${query}` : `/export/batch${query}`;
      const { blob, filename } = await downloadBlob(path, `batch-${ts}.${format}`);

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '无法连接工作台 server 进程');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          导出批次
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">导出有效数据批次</p>
          <p className="text-xs text-muted-foreground">
            筛出有实质信号的洞察 + 关联帖子/评论，打包下载（可 AirDrop 给手机导入）。
          </p>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="export-format">格式</Label>
            <NativeSelect
              id="export-format"
              className="w-full"
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
            >
              <NativeSelectOption value="sqlite">.sqlite（移动端导入）</NativeSelectOption>
              <NativeSelectOption value="json">.json</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="export-days">最近天数（空 = 全量）</Label>
            <Input
              id="export-days"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="如 7"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="export-intensity">最低强度</Label>
            <NativeSelect
              id="export-intensity"
              className="w-full"
              value={minIntensity}
              onChange={(e) => setMinIntensity(e.target.value as IntensityOpt)}
            >
              <NativeSelectOption value="">全部</NativeSelectOption>
              <NativeSelectOption value="MEDIUM">中及以上</NativeSelectOption>
              <NativeSelectOption value="HIGH">仅高强度</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="export-subreddit">版块（空 = 全部）</Label>
            <NativeSelect
              id="export-subreddit"
              className="w-full"
              value={subreddit}
              onChange={(e) => setSubreddit(e.target.value)}
            >
              <NativeSelectOption value="">全部版块</NativeSelectOption>
              {subreddits.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {s}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="export-limit">上限条数（空 = 不限）</Label>
            <Input
              id="export-limit"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="如 200"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <Button className="w-full" onClick={download} disabled={busy}>
          {busy ? '导出中…' : '下载'}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
