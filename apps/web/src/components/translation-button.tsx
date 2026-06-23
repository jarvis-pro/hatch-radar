import { useState, type ReactNode } from 'react';
import { ChevronDown, Languages } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@hatch-radar/ui/components/popover';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { can, useAuth } from '@/auth/auth-context';
import {
  useTranslationProviders,
  type TranslationProviderOption,
  type usePostTranslation,
} from '@/translation/post-translation';

/** 档位措辞：azure=机翻免费走量（日常默认）/ claude_cli=高质量耗订阅额度（个别重要内容） */
function kindLabel(kind: TranslationProviderOption['kind']): string {
  return kind === 'azure' ? '机翻·免费走量' : '高质量·耗额度';
}

/**
 * 翻译按钮 + 原文/中文切换：
 * - 无可译内容（state=none）不渲染；有译文时显示「显示原文 / 显示中文」切换；
 * - first/incremental（需 analyze:run）显示翻译按钮：
 *   · 有默认翻译模型 → 主按钮直接走默认（通常 Azure 机翻）；多于一个模型时附下拉，可临时选 Claude 高质量档；
 *   · 无默认 → 主按钮点开下拉选一个模型（本次使用）；
 *   · 无任何启用的翻译模型（claude_cli / azure）→ 禁用并提示去设置页配置；
 * - translating 显示进行中。
 */
export function TranslationButton({ t }: { t: ReturnType<typeof usePostTranslation> }) {
  const { user } = useAuth();
  const canRun = can(user, 'analyze:run');
  const providersQ = useTranslationProviders();
  const [pickerOpen, setPickerOpen] = useState(false);
  const s = t.status;
  if (!s || s.state === 'none') {
    return null;
  }

  const toggle = t.hasTranslations ? (
    <Button size="xs" variant="outline" onClick={() => t.setShowZh(!t.showZh)}>
      {t.showZh ? '显示原文' : '显示中文'}
    </Button>
  ) : null;

  const label =
    s.state === 'first' ? `翻译（${s.untranslated} 条）` : `翻译增量（${s.untranslated} 条新）`;
  const canTranslate = canRun && (s.state === 'first' || s.state === 'incremental');

  /** 翻译按钮本体（onClick 省略时由 Popover 触发器接管点击） */
  const translateBtn = (onClick?: () => void): ReactNode => (
    <Button
      size="xs"
      variant={s.state === 'first' ? 'default' : 'outline'}
      onClick={onClick}
      disabled={t.enqueuing || providersQ.isLoading}
    >
      {t.enqueuing ? <Spinner className="size-3.5" /> : <Languages className="size-3.5" />}
      {label}
    </Button>
  );

  const models = providersQ.data?.providers ?? [];
  const hasDefault = (providersQ.data?.defaultId ?? null) != null;

  /** 模型选择下拉（列全部可用翻译档，标注档位措辞） */
  const pickerMenu = (
    <PopoverContent align="start" className="w-64 p-1">
      <p className="px-2 py-1.5 text-xs text-muted-foreground">选择翻译模型</p>
      {models.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => {
            setPickerOpen(false);
            t.enqueue(m.id);
          }}
          className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
        >
          <span className="truncate font-medium">{m.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{kindLabel(m.kind)}</span>
        </button>
      ))}
    </PopoverContent>
  );

  let action: ReactNode = null;
  if (s.state === 'translating') {
    action = (
      <Button size="xs" variant="ghost" disabled>
        <Spinner className="size-3.5" />
        翻译中…
      </Button>
    );
  } else if (canTranslate) {
    if (providersQ.isLoading) {
      action = translateBtn(); // 加载模型清单中：先渲染禁用态
    } else if (models.length === 0) {
      action = (
        <Button
          size="xs"
          variant="outline"
          disabled
          title="请先在设置页添加翻译模型（Azure 机翻 / Claude 订阅）"
        >
          <Languages className="size-3.5" />
          翻译（需先配置模型）
        </Button>
      );
    } else if (hasDefault) {
      // 主按钮走默认翻译档；多于一个档位时附下拉，可临时切到 Claude 高质量
      action = (
        <div className="flex items-center gap-1">
          {translateBtn(() => t.enqueue())}
          {models.length > 1 ? (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="xs"
                  variant={s.state === 'first' ? 'default' : 'outline'}
                  aria-label="选择翻译模型"
                  disabled={t.enqueuing}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </PopoverTrigger>
              {pickerMenu}
            </Popover>
          ) : null}
        </div>
      );
    } else {
      // 无默认 → 主按钮点开下拉选一个模型
      action = (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>{translateBtn()}</PopoverTrigger>
          {pickerMenu}
        </Popover>
      );
    }
  }

  if (!toggle && !action) {
    return null;
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {toggle}
        {action}
      </div>
      {s.lastError && s.state !== 'translating' ? (
        <p className="text-xs text-destructive">上次翻译失败：{s.lastError}</p>
      ) : null}
    </div>
  );
}
