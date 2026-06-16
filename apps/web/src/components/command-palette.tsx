import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Moon, Sun } from 'lucide-react';
import { hasPermission, type CurrentUser } from '@hatch-radar/shared';
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
import { NAV_GROUPS } from '@/lib/nav';

/**
 * 命令面板（⌘K / Ctrl+K）：跨页跳转 + 主题切换。
 * 导航项按当前用户权限过滤（与侧边栏同源 NAV_GROUPS）；专业工具的「检索/跳转」肌肉记忆。
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

  const go = (to: string): void => {
    onOpenChange(false);
    navigate(to);
  };
  const pickTheme = (t: Theme): void => {
    onOpenChange(false);
    setTheme(t);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="命令面板"
      description="搜索页面或执行操作"
      className="shadow-elevated"
    >
      <CommandInput placeholder="跳转页面、执行操作…" />
      <CommandList>
        <CommandEmpty>无匹配项。</CommandEmpty>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((it) =>
            hasPermission(user.role, user.permissions, it.perm),
          );
          if (items.length === 0) return null;
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
