import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Database,
  FileText,
  KeyRound,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from 'lucide-react';
import {
  hasPermission,
  type CurrentUser,
  type Insight,
  type Paged,
  type PostRow,
} from '@hatch-radar/shared';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@hatch-radar/ui/components/command';
import { useTheme, type Theme } from '@hatch-radar/ui/components/theme-provider';
import { api } from '@/api/client';
import { NAV_GROUPS } from '@/lib/nav';

/** 设置页内分区（与 settings.tsx 的 ?tab= 对齐），命令面板可直达。 */
const SETTINGS_TABS = [
  { tab: 'models', label: '模型与密钥', icon: KeyRound },
  { tab: 'sources', label: '数据来源', icon: Database },
  { tab: 'runtime', label: '运行参数', icon: SlidersHorizontal },
] as const;

/** 简易防抖：value 停止变化 ms 后才更新返回值。 */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * 命令面板（⌘K / Ctrl+K）：情报检索 + 跳转 + 动作。
 * - 输入即搜：防抖打 /insights、/posts（按权限），返回结果可直达详情；
 * - 跳转：页面（与侧栏同源 NAV_GROUPS，按权限过滤）+ 设置子页；
 * - 动作：主题切换。
 * 静态项由 cmdk 按输入过滤；异步结果用「含当前输入的 value」保证恒匹配（服务端已筛）。
 */
export function CommandPalette({
  user,
  open,
  onOpenChange,
}: {
  user: CurrentUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 220);

  const canInsights = hasPermission(user.role, user.permissions, 'insights:view');
  const canPosts = hasPermission(user.role, user.permissions, 'posts:view');
  const canSettings = hasPermission(user.role, user.permissions, 'settings:manage');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // 输入即搜（≥2 字符）：并行查洞察与帖子，各取前 5 条。
  const resultsQ = useQuery({
    queryKey: ['cmdk-search', term, canInsights, canPosts],
    enabled: open && term.length >= 2,
    queryFn: async () => {
      const q = encodeURIComponent(term);
      const [insights, posts] = await Promise.all([
        canInsights ? api.get<Paged<Insight>>(`/insights?q=${q}`) : Promise.resolve(null),
        canPosts ? api.get<Paged<PostRow>>(`/posts?q=${q}`) : Promise.resolve(null),
      ]);
      return {
        insights: insights?.items.slice(0, 5) ?? [],
        posts: posts?.items.slice(0, 5) ?? [],
      };
    },
  });

  const close = (o: boolean): void => {
    if (!o) {
      setSearch('');
    }
    onOpenChange(o);
  };
  const go = (to: string): void => {
    onOpenChange(false);
    setSearch('');
    navigate(to);
  };
  const pickTheme = (t: Theme): void => {
    onOpenChange(false);
    setSearch('');
    setTheme(t);
  };

  const results = resultsQ.data;

  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      title="命令面板"
      description="搜索洞察 / 帖子，或跳转页面、执行操作"
      className="shadow-elevated"
    >
      <CommandInput
        placeholder="搜索洞察 / 帖子，或跳转…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          {term.length >= 2 ? '无匹配项。' : '输入关键词搜索洞察 / 帖子。'}
        </CommandEmpty>

        {results && results.insights.length > 0 ? (
          <CommandGroup heading="洞察">
            {results.insights.map((it) => (
              <CommandItem
                key={`ins-${it.id}`}
                value={`${term} 洞察 ${it.postTitle} ${it.id}`}
                onSelect={() => go(`/insights/${it.id}`)}
              >
                <Sparkles />
                <span className="truncate">{it.postTitle}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results && results.posts.length > 0 ? (
          <CommandGroup heading="帖子">
            {results.posts.map((p) => (
              <CommandItem
                key={`post-${p.id}`}
                value={`${term} 帖子 ${p.title} ${p.id}`}
                onSelect={() => go(`/posts/${p.id}`)}
              >
                <FileText />
                <span className="truncate">{p.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((it) =>
            hasPermission(user.role, user.permissions, it.perm),
          );
          if (items.length === 0) {
            return null;
          }
          return (
            <CommandGroup key={group.label} heading={group.label}>
              {items.map((it) => (
                <CommandItem
                  key={it.to}
                  value={`${group.label} ${it.label}`}
                  onSelect={() => go(it.to)}
                >
                  <it.icon />
                  {it.label}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {canSettings ? (
          <CommandGroup heading="设置">
            {SETTINGS_TABS.map((s) => (
              <CommandItem
                key={s.tab}
                value={`设置 ${s.label}`}
                onSelect={() => go(`/settings?tab=${s.tab}`)}
              >
                <s.icon />
                {s.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading="主题">
          <CommandItem value="主题 浅色 light" onSelect={() => pickTheme('light')}>
            <Sun />
            浅色
          </CommandItem>
          <CommandItem value="主题 深色 dark" onSelect={() => pickTheme('dark')}>
            <Moon />
            深色
          </CommandItem>
          <CommandItem value="主题 跟随系统 system" onSelect={() => pickTheme('system')}>
            <Monitor />
            跟随系统
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
