import { createContext, use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@hatch-radar/ui/components/sonner';
import { api, ApiError } from '@/api/client';

/** 某帖翻译进度与按钮状态（对应 GET /api/translations/posts/:id）。 */
export interface TranslationStatus {
  /** 可翻译条目总数（标题+正文+各评论，按内容哈希去重） */
  total: number;
  /** 已译条目数 */
  translated: number;
  /** 待译条目数 */
  untranslated: number;
  /** 是否有活跃翻译任务（queued/running） */
  active: boolean;
  /** 按钮三态：none 无可译 / first 首次 / incremental 增量 / translating 进行中 / done 已全译 */
  state: 'none' | 'first' | 'incremental' | 'translating' | 'done';
  /** 最近一次翻译失败原因（最近一条翻译任务为 failed 时）；成功/重试后自动清空 */
  lastError: string | null;
}

/** 译文视图：供详情页正文 / 评论树按内容哈希取中文（未命中回退原文）。 */
export interface TranslationView {
  /** 是否优先显示中文（有译文时） */
  showZh: boolean;
  /** 按内容哈希取中文译文；无译文 / 未开启时返回 undefined */
  get: (hash: string | null | undefined) => string | undefined;
}

const TranslationViewContext = createContext<TranslationView>({
  showZh: false,
  get: () => undefined,
});

/** 包裹详情页主列，向下（含评论树）提供译文视图。 */
export const TranslationViewProvider = TranslationViewContext.Provider;

/** 取当前译文视图（无 Provider 时默认不译，渲染原文）。 */
export function useTranslationView(): TranslationView {
  return use(TranslationViewContext);
}

/**
 * 帖子翻译数据 + 操作的聚合 hook：状态轮询（进行中每 3s）/ 已译内容（按内容哈希）/ 入队 / 中文开关。
 * 默认 showZh=true——有译文的部分显示中文、其余回退原文，正合审核需要；开关可强制看原文。
 * @param postId 帖子 ID
 */
export function usePostTranslation(postId: string | undefined) {
  const qc = useQueryClient();
  const [showZh, setShowZh] = useState(true);

  const statusQ = useQuery({
    queryKey: ['translation-status', postId],
    queryFn: () => api.get<TranslationStatus>(`/translations/posts/${postId}`),
    enabled: !!postId,
    refetchInterval: (q) => (q.state.data?.active ? 3000 : false),
  });

  const translatedCount = statusQ.data?.translated ?? 0;
  const contentQ = useQuery({
    queryKey: ['translation-content', postId, translatedCount],
    queryFn: () =>
      api.get<{ translations: Record<string, string> }>(`/translations/posts/${postId}/content`),
    enabled: !!postId && translatedCount > 0,
  });

  const enqueue = useMutation({
    // providerId：无默认翻译模型时由弹窗选定，一次性指定本次用模型；否则后端回落默认
    mutationFn: (providerId?: number) =>
      api.post<{ enqueued: boolean }>(
        `/translations/posts/${postId}`,
        providerId ? { providerId } : {},
      ),
    onSuccess: (r) => {
      toast.success(r.enqueued ? '已入队翻译，完成后自动显示中文' : '该帖已有翻译任务进行中');
      void qc.invalidateQueries({ queryKey: ['translation-status', postId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '入队翻译失败'),
  });

  const translations = contentQ.data?.translations ?? {};

  return {
    status: statusQ.data,
    showZh,
    setShowZh,
    hasTranslations: Object.keys(translations).length > 0,
    enqueue: (providerId?: number) => enqueue.mutate(providerId),
    enqueuing: enqueue.isPending,
    view: {
      showZh,
      get: (hash: string | null | undefined) => (hash ? translations[hash] : undefined),
    } satisfies TranslationView,
  };
}

/** 单个可选翻译模型（claude_cli 高质量档 / azure 机翻走量档）。 */
export interface TranslationProviderOption {
  id: number;
  label: string;
  model: string;
  /** 档位：azure=机翻·免费走量（日常默认）/ claude_cli=高质量·耗订阅额度（个别重要内容） */
  kind: 'claude_cli' | 'azure';
}

/** 可选翻译模型 + 当前默认（GET /api/translations/providers）。 */
export interface TranslationProvidersInfo {
  /** 当前默认翻译模型 id（translation_provider_id ?? active 且为启用 claude_cli / azure）；null=需弹窗选 */
  defaultId: number | null;
  /** 可选的翻译模型清单（claude_cli / azure） */
  providers: TranslationProviderOption[];
}

/** 取可选翻译模型清单 + 当前默认（全局缓存，供按钮判断「直接翻译」还是「弹窗选模型」）。 */
export function useTranslationProviders() {
  return useQuery({
    queryKey: ['translation-providers'],
    queryFn: () => api.get<TranslationProvidersInfo>('/translations/providers'),
    staleTime: 5 * 60_000,
  });
}

/** Azure 机翻当月用量 + 免费档参照线（GET /api/translations/usage）。 */
export interface TranslationUsage {
  /** Azure 当月已消耗源字符数（仅 done 译文，本地判中文跳过的不计） */
  azureCharsThisMonth: number;
  /** Azure 免费档月度配额（字符/月）——超过即进入收费 */
  azureFreeLimit: number;
}

/** 取 Azure 机翻当月用量（设置页 / 导出面板的免费额度安全阀）。 */
export function useTranslationUsage(enabled = true) {
  return useQuery({
    queryKey: ['translation-usage'],
    queryFn: () => api.get<TranslationUsage>('/translations/usage'),
    enabled,
    staleTime: 60_000,
  });
}
