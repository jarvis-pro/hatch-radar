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
    mutationFn: () => api.post<{ enqueued: boolean }>(`/translations/posts/${postId}`),
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
    enqueue: () => enqueue.mutate(),
    enqueuing: enqueue.isPending,
    view: {
      showZh,
      get: (hash: string | null | undefined) => (hash ? translations[hash] : undefined),
    } satisfies TranslationView,
  };
}
