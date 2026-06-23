import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';

// Radix Select 不接受空字符串 value，用哨兵代表「全部」（导航时还原为去掉该参数）
const ALL = '__all__';

/** 单个下拉筛选项配置 */
export interface FilterSelectConfig {
  /** 查询参数名（如 source / subreddit / intensity / status） */
  name: string;
  /** 占位文案，同时作为「全部」选项的标签（如 全部来源） */
  placeholder: string;
  /** 当前选中值（''=全部） */
  value: string;
  /** 可选项列表：value 为查询参数值，label 为展示文案 */
  options: { value: string; label: string }[];
}

/** FilterBar 组件 props */
export interface FilterBarProps {
  /** 列表页路径，作为跳转目标与「清除全部」目标 */
  basePath: string;
  /** 下拉筛选项配置列表，按顺序渲染 */
  selects: FilterSelectConfig[];
  /** 搜索框对应的查询参数名，默认 'q' */
  searchName?: string;
  /** 当前已提交的搜索值（来自 URL），用于初始化与同步搜索框 */
  searchValue?: string;
  /** 搜索框占位文案 */
  searchPlaceholder: string;
  /** 当前是否有任意筛选生效，决定是否渲染「已选条件」chip 行 */
  hasFilter: boolean;
}

/**
 * 筛选工具条：上排为下拉 + 搜索框，下排为「已生效条件」的可删 chip。
 * 选择下拉即时应用（路由跳转）；搜索回车或点「筛选」应用；点 chip 上的 × 单独移除该条件，
 * 「清除全部」一键重置；翻页参数在筛选变化时自动重置。
 */
export function FilterBar({
  basePath,
  selects,
  searchName = 'q',
  searchValue,
  searchPlaceholder,
  hasFilter,
}: FilterBarProps) {
  const navigate = useNavigate();
  // 用户正在输入、尚未提交的搜索草稿（已提交值在 URL 上，即 searchValue）
  const [searchDraft, setSearchDraft] = useState(searchValue ?? '');
  // 外部导航（如点击标签 /insights?q=xxx）后，把搜索框同步到 URL 的最新值
  useEffect(() => setSearchDraft(searchValue ?? ''), [searchValue]);

  /** 以「已提交」各筛选值为基础叠加 overrides 构造 URL（空值忽略，不带 page → 回到第 1 页）。 */
  function hrefWith(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    for (const s of selects) {
      const v = s.name in overrides ? overrides[s.name] : s.value;
      if (v) {
        params.set(s.name, v);
      }
    }

    const qv = searchName in overrides ? overrides[searchName] : (searchValue ?? '');
    if (qv) {
      params.set(searchName, qv);
    }

    const qs = params.toString();

    return qs ? `${basePath}?${qs}` : basePath;
  }

  // 已生效条件 → 可删 chip（基于「已提交」值，含下拉与搜索）
  const chips = selects
    .filter((s) => s.value)
    .map((s) => ({
      key: s.name,
      label: s.options.find((o) => o.value === s.value)?.label ?? s.value,
      remove: () => navigate(hrefWith({ [s.name]: '' })),
    }));
  if (searchValue) {
    chips.push({
      key: searchName,
      label: `搜索：${searchValue}`,
      remove: () => {
        setSearchDraft('');
        navigate(hrefWith({ [searchName]: '' }));
      },
    });
  }

  return (
    <div className="mb-4 space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(hrefWith({ [searchName]: searchDraft.trim() }));
        }}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        {selects.map((s) => (
          <Select
            key={s.name}
            value={s.value || ALL}
            onValueChange={(v) => navigate(hrefWith({ [s.name]: v === ALL ? '' : v }))}
          >
            <SelectTrigger className="w-full sm:w-auto sm:min-w-34" aria-label={s.placeholder}>
              <SelectValue placeholder={s.placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{s.placeholder}</SelectItem>
              {s.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        <div className="relative min-w-0 flex-1 sm:min-w-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name={searchName}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
          />
        </div>

        <Button type="submit">筛选</Button>
      </form>

      {hasFilter ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.remove}
              aria-label={`移除筛选：${c.label}`}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1.5 pl-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {c.label}
              <X className="size-3" />
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setSearchDraft('');
              navigate(basePath);
            }}
          >
            清除全部
          </Button>
        </div>
      ) : null}
    </div>
  );
}
