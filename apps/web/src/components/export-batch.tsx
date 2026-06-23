import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Languages } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { NativeSelect, NativeSelectOption } from '@hatch-radar/ui/components/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@hatch-radar/ui/components/popover';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { toast } from '@hatch-radar/ui/components/sonner';
import { api, ApiError, downloadBlob } from '@/api/client';
import { can, useAuth } from '@/auth/auth-context';
import { useTranslationProviders } from '@/translation/post-translation';

type IntensityOpt = '' | 'MEDIUM' | 'HIGH';

/** 导出筛选（数值化；与 server parseExportFilter 对齐），覆盖率 / 批量补翻 / 下载共用 */
interface ExportFilterBody {
  since?: number;
  minIntensity?: 'MEDIUM' | 'HIGH';
  subreddit?: string;
  limit?: number;
}

/** 一个导出批次的译文覆盖率（GET /api/translations/coverage） */
interface Coverage {
  /** 命中且仍存在的帖子数 */
  posts: number;
  /** 内容已全部翻译的帖子数 */
  translated: number;
  /** 仍有未翻内容、需补翻的帖子数 */
  untranslated: number;
}

/** 把数值化筛选拼成覆盖率查询串 */
function coverageQs(f: ExportFilterBody): string {
  const qs = new URLSearchParams();
  if (f.since) {
    qs.set('since', String(f.since));
  }

  if (f.minIntensity) {
    qs.set('minIntensity', f.minIntensity);
  }

  if (f.subreddit) {
    qs.set('subreddit', f.subreddit);
  }

  if (f.limit) {
    qs.set('limit', String(f.limit));
  }

  const s = qs.toString();

  return s ? `?${s}` : '';
}

/**
 * 「导出批次」入口（同源直连 /api/export/*）：按条件筛出有效数据，下载为 .json 批次。
 *
 * 翻译并入导出流程（旗舰）：选好筛选后展示本批译文覆盖率，可「翻译缺失 N 篇」批量补翻（走默认翻译模型，
 * 异步入队、覆盖率自动刷新）后再导出，或「直接导出」（未翻内容显示原文）。翻译只服务人工阅读。
 */
export function ExportBatchButton({ subreddits }: { subreddits: string[] }) {
  const { user } = useAuth();
  const canTranslate = can(user, 'analyze:run');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('');
  const [minIntensity, setMinIntensity] = useState<IntensityOpt>('');
  const [subreddit, setSubreddit] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 批量补翻已入队、正在异步翻译——据此对覆盖率轮询直至补齐
  const [translating, setTranslating] = useState(false);

  const filter = useMemo<ExportFilterBody>(() => {
    const f: ExportFilterBody = {};
    const d = Number(days);
    // 「最近 N 天」→ since（Unix 秒），与 server parseExportFilter 对齐
    if (days && Number.isFinite(d) && d > 0) {
      f.since = Math.floor(Date.now() / 1000) - Math.round(d * 86400);
    }

    if (minIntensity) {
      f.minIntensity = minIntensity;
    }

    if (subreddit.trim()) {
      f.subreddit = subreddit.trim();
    }

    const n = Number(limit);
    if (limit && Number.isInteger(n) && n > 0) {
      f.limit = n;
    }

    return f;
  }, [days, minIntensity, subreddit, limit]);

  const providersQ = useTranslationProviders();
  const defaultProvider =
    providersQ.data?.providers.find((p) => p.id === providersQ.data?.defaultId) ?? null;

  const coverageQ = useQuery({
    queryKey: ['translation-coverage', filter],
    queryFn: () => api.get<Coverage>(`/translations/coverage${coverageQs(filter)}`),
    enabled: open && canTranslate,
    // 补翻入队后轮询，直至无待翻；翻译失败/停滞时关闭弹窗即停（enabled 转 false）
    refetchInterval: (q) => (translating && (q.state.data?.untranslated ?? 0) > 0 ? 4000 : false),
  });
  const cov = coverageQ.data;

  // 待翻清零即视为补翻完成，停止轮询
  useEffect(() => {
    if (translating && cov && cov.untranslated === 0) {
      setTranslating(false);
    }
  }, [translating, cov]);

  const batchMut = useMutation({
    mutationFn: () => api.post<{ enqueued: number; posts: number }>('/translations/batch', filter),
    onSuccess: (r) => {
      if (r.posts === 0) {
        toast.info('这批没有需要补翻的内容');

        return;
      }

      setTranslating(true);
      toast.success(`已入队翻译 ${r.enqueued} 篇，完成后覆盖率会自动更新，再导出即带中文`);
      void qc.invalidateQueries({ queryKey: ['translation-coverage', filter] });
      void qc.invalidateQueries({ queryKey: ['translation-usage'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '批量翻译入队失败'),
  });

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (filter.since) {
        qs.set('since', String(filter.since));
      }

      if (filter.minIntensity) {
        qs.set('minIntensity', filter.minIntensity);
      }

      if (filter.subreddit) {
        qs.set('subreddit', filter.subreddit);
      }

      if (filter.limit) {
        qs.set('limit', String(filter.limit));
      }

      const ts = Math.floor(Date.now() / 1000);
      const query = qs.toString() ? `?${qs.toString()}` : '';
      const { blob, filename } = await downloadBlob(`/export/batch${query}`, `batch-${ts}.json`);

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

  const pct = cov && cov.posts > 0 ? Math.round((cov.translated / cov.posts) * 100) : 0;
  const needsTranslation = canTranslate && cov != null && cov.untranslated > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          导出批次
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">导出有效数据批次</p>
          <p className="text-xs text-muted-foreground">
            筛出有实质信号的洞察 + 关联帖子/评论，打包下载为 JSON 批次。
          </p>
        </div>

        <div className="grid gap-3">
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

        {/* 译文覆盖率：让「先补翻 / 直接导出」成为有数据支撑的决策（需 analyze:run 才显示补翻能力） */}
        {canTranslate ? (
          <div className="space-y-2 rounded-md border bg-muted/40 p-2.5">
            {coverageQ.isPending ? (
              <p className="text-xs text-muted-foreground">统计本批译文覆盖…</p>
            ) : coverageQ.isError ? (
              <p className="text-xs text-destructive">覆盖率获取失败</p>
            ) : cov && cov.posts === 0 ? (
              <p className="text-xs text-muted-foreground">当前条件无匹配洞察。</p>
            ) : cov ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">译文覆盖</span>
                  <span className="tabular-nums">
                    {cov.translated} / {cov.posts} 篇 · {pct}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-border">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Languages className="size-3 shrink-0" />
                  {defaultProvider ? (
                    <span>
                      翻译用 {defaultProvider.label}（
                      {defaultProvider.kind === 'azure' ? '机翻·免费走量' : '高质量·耗额度'}）
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-500">
                      未设默认翻译模型，请先去设置页指定
                    </span>
                  )}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="flex gap-2">
          {needsTranslation ? (
            <Button
              className="flex-1"
              onClick={() => batchMut.mutate()}
              disabled={batchMut.isPending || translating || !defaultProvider}
            >
              {batchMut.isPending || translating ? (
                <Spinner className="size-3.5" />
              ) : (
                <Languages className="size-3.5" />
              )}
              {translating
                ? `翻译中（剩 ${cov?.untranslated ?? 0}）`
                : `翻译缺失 ${cov?.untranslated} 篇`}
            </Button>
          ) : null}
          <Button
            className="flex-1"
            variant={needsTranslation ? 'outline' : 'default'}
            onClick={() => void download()}
            disabled={busy}
          >
            {busy ? '导出中…' : needsTranslation ? '直接导出' : '下载'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
