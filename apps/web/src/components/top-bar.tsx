import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { CurrentUser } from '@hatch-radar/shared';
import { Button } from '@hatch-radar/ui/components/button';
import { Separator } from '@hatch-radar/ui/components/separator';
import { SidebarTrigger } from '@hatch-radar/ui/components/sidebar';
import { ModeToggle } from '@hatch-radar/ui/components/mode-toggle';
import { can } from '@/auth/auth-context';
import { CommandPalette } from '@/components/command-palette';
import { SystemPulse } from '@/components/system-pulse';
import { NAV_GROUPS } from '@/lib/nav';

/** 当前路径对应的页面标签（用于上下文栏；详情页归属其列表区段）。 */
function currentLabel(pathname: string): string {
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (it.match(pathname)) return it.label;
    }
  }
  if (pathname.startsWith('/account')) return '个人中心';
  return '';
}

/**
 * 上下文栏（取代旧的全宽顶部导航）：侧栏开关 + 当前区段 + 全局搜索(⌘K) + 系统脉搏 + 主题。
 * 导航职责整体下放到侧边栏；这条只承载「我在哪 + 全局动作」。
 */
export function TopBar({ user }: { user: CurrentUser }) {
  const { pathname } = useLocation();
  const [cmdOpen, setCmdOpen] = useState(false);
  const label = currentLabel(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur sm:px-4">
      <SidebarTrigger className="text-muted-foreground" />
      <Separator orientation="vertical" className="mr-1 hidden h-5 sm:block" />
      {label ? <span className="text-sm font-medium">{label}</span> : null}

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCmdOpen(true)}
          className="h-8 gap-2 text-muted-foreground sm:w-56 sm:justify-start"
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">搜索 / 跳转…</span>
          <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] leading-relaxed sm:inline-block">
            ⌘K
          </kbd>
        </Button>
        {can(user, 'insights:view') ? <SystemPulse /> : null}
        <ModeToggle />
      </div>

      <CommandPalette user={user} open={cmdOpen} onOpenChange={setCmdOpen} />
    </header>
  );
}
