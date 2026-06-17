import { Languages } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { can, useAuth } from '@/auth/auth-context';
import type { usePostTranslation } from '@/translation/post-translation';

/**
 * 翻译按钮 + 原文/中文切换：
 * - 无可译内容（state=none）不渲染；
 * - 有译文时显示「显示原文 / 显示中文」切换；
 * - first/incremental（需 analyze:run 能力）显示「翻译 / 翻译增量」入队按钮；translating 显示进行中。
 */
export function TranslationButton({ t }: { t: ReturnType<typeof usePostTranslation> }) {
  const { user } = useAuth();
  const canRun = can(user, 'analyze:run');
  const s = t.status;
  if (!s || s.state === 'none') return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {t.hasTranslations ? (
        <Button size="xs" variant="outline" onClick={() => t.setShowZh(!t.showZh)}>
          {t.showZh ? '显示原文' : '显示中文'}
        </Button>
      ) : null}
      {s.state === 'translating' ? (
        <Button size="xs" variant="ghost" disabled>
          <Spinner className="size-3.5" />
          翻译中…
        </Button>
      ) : canRun && (s.state === 'first' || s.state === 'incremental') ? (
        <Button
          size="xs"
          variant={s.state === 'first' ? 'default' : 'outline'}
          onClick={t.enqueue}
          disabled={t.enqueuing}
        >
          {t.enqueuing ? <Spinner className="size-3.5" /> : <Languages className="size-3.5" />}
          {s.state === 'first'
            ? `翻译（${s.untranslated} 条）`
            : `翻译增量（${s.untranslated} 条新）`}
        </Button>
      ) : null}
    </div>
  );
}
