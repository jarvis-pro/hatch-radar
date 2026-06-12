'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
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
  options: { value: string; label: string }[];
}

/**
 * 筛选条（客户端）：shadcn Select 下拉 + 搜索框。
 * 选择下拉即时应用（路由跳转）；搜索回车或点「筛选」应用；翻页参数在筛选变化时自动重置。
 */
export function FilterBar({
  basePath,
  selects,
  searchName = 'q',
  searchValue,
  searchPlaceholder,
  hasFilter,
}: {
  /** 列表页路径，作为跳转目标与「重置」目标 */
  basePath: string;
  selects: FilterSelectConfig[];
  searchName?: string;
  searchValue?: string;
  searchPlaceholder: string;
  hasFilter: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(searchValue ?? '');
  // 外部导航（如点击标签 /?q=xxx）后，把搜索框同步到 URL 的最新值
  useEffect(() => setQ(searchValue ?? ''), [searchValue]);

  /** 以当前各筛选值为基础，叠加 overrides，构造目标 URL（空值忽略，不带 page → 回到第 1 页） */
  function hrefWith(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    for (const s of selects) {
      const v = s.name in overrides ? overrides[s.name] : s.value;
      if (v) params.set(s.name, v);
    }
    const qv = searchName in overrides ? overrides[searchName] : q;
    if (qv) params.set(searchName, qv);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push(hrefWith({ [searchName]: q.trim() }));
      }}
      className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
    >
      {selects.map((s) => (
        <Select
          key={s.name}
          value={s.value || ALL}
          onValueChange={(v) => router.push(hrefWith({ [s.name]: v === ALL ? '' : v }))}
        >
          <SelectTrigger className="w-full sm:w-auto sm:min-w-[8.5rem]" aria-label={s.placeholder}>
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

      <div className="relative min-w-0 flex-1 sm:min-w-[12rem]">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          name={searchName}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-8"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit">筛选</Button>
        {hasFilter ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQ('');
              router.push(basePath);
            }}
          >
            重置
          </Button>
        ) : null}
      </div>
    </form>
  );
}
