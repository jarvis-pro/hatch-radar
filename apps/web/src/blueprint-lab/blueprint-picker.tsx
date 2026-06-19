/**
 * 图纸选择器（原型）—— 顶部「主标题」即下拉触发器：点名称切换图纸。
 *
 * 触发器只包裹「图标 + 名称 + 类别标签 + chevron」，shrink-to-fit、左对齐，可点区域仅限标题；
 * 描述（note）放在触发器下方作普通文本（不可点），故没有占满整行的大色块。
 *
 * 下拉面板带搜索 + 懒加载：列表只渲染前 N 条，滚动到底再加载下一批；搜索走手动过滤（关掉
 * cmdk 内置过滤，否则它只认已渲染项、会漏掉尚未渲染的图纸）。数据真到上千再换虚拟滚动即可。
 */
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@hatch-radar/ui/components/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@hatch-radar/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@hatch-radar/ui/components/popover';
import { cn } from '@hatch-radar/ui/lib/utils';

import { KIND_META } from './constants';
import type { Blueprint } from './types';
import { sourcesSummary } from './util';

/** 懒加载每批条数。 */
const PAGE_SIZE = 12;

export function BlueprintPicker({
  blueprints,
  counts,
  selectedId,
  onSelect,
}: {
  blueprints: Blueprint[];
  counts: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const selected = blueprints.find((b) => b.id === selectedId) ?? blueprints[0] ?? null;

  // 手动过滤（配合懒加载，必须关掉 cmdk 内置过滤）。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blueprints;
    return blueprints.filter((b) =>
      `${b.label} ${sourcesSummary(b)} ${KIND_META[b.kind].label}`.toLowerCase().includes(q),
    );
  }, [blueprints, query]);

  // 搜索变化时回到第一批。
  useEffect(() => setVisible(PAGE_SIZE), [query]);

  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  if (!selected) return null;
  const SelectedIcon = KIND_META[selected.kind].icon;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setQuery(''); // 每次打开都从完整列表开始
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            className="-mx-2 -my-1 flex max-w-full items-center gap-2 self-start rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/50"
          >
            <SelectedIcon className="size-5 shrink-0 text-primary" />
            <span className="truncate text-xl font-semibold tracking-tight">{selected.label}</span>
            <Badge variant="secondary" className="shrink-0">
              {KIND_META[selected.kind].label}
            </Badge>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px] max-w-[90vw] p-0">
          <Command shouldFilter={false}>
            <CommandInput placeholder="搜索图纸 / 来源…" value={query} onValueChange={setQuery} />
            <CommandList
              onScroll={(e) => {
                const el = e.currentTarget;
                if (hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
                  setVisible((v) => v + PAGE_SIZE);
                }
              }}
            >
              <CommandEmpty>未找到匹配的图纸</CommandEmpty>
              <CommandGroup>
                {shown.map((b) => {
                  const Icon = KIND_META[b.kind].icon;
                  const active = b.id === selected.id;
                  const n = counts[b.id] ?? 0;
                  return (
                    <CommandItem
                      key={b.id}
                      value={b.id}
                      onSelect={() => {
                        onSelect(b.id);
                        setOpen(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          active ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{b.label}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {sourcesSummary(b)}
                        </span>
                      </span>
                      <Badge
                        variant={n > 0 ? 'secondary' : 'outline'}
                        className="shrink-0 tabular-nums"
                      >
                        {n} 进程
                      </Badge>
                      <Check
                        className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {hasMore ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  下滑加载更多（{shown.length}/{filtered.length}）
                </p>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.note ? (
        <p className="truncate text-sm text-muted-foreground">{selected.note}</p>
      ) : null}
    </div>
  );
}
