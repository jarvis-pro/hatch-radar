import { Fragment, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Command, Search } from 'lucide-react';
import type { CurrentUser } from '@hatch-radar/shared';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@hatch-radar/ui/components/breadcrumb';
import { Separator } from '@hatch-radar/ui/components/separator';
import { SidebarTrigger } from '@hatch-radar/ui/components/sidebar';
import { ModeToggle } from '@hatch-radar/ui/components/mode-toggle';
import { can } from '@/auth/auth-context';
import { CommandPalette } from '@/components/command-palette';
import { SystemPulse } from '@/components/system-pulse';
import { NAV_GROUPS } from '@/lib/nav';

interface Crumb {
  label: string;
  to?: string;
}

/** 个人中心三页（+强制改密）在面包屑里的子级标签。 */
const ACCOUNT_SUB: Record<string, string> = {
  '/account/profile': '资料',
  '/account/security': '安全',
  '/account/sessions': '会话',
  '/account/permissions': '我的权限',
  '/account/password': '修改密码',
};

/** 由当前路径推导面包屑：区段 +（详情页再加一级）。 */
function crumbsFor(pathname: string): Crumb[] {
  let section: { label: string; to: string } | undefined;
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (it.match(pathname)) section = { label: it.label, to: it.to };
    }
  }
  if (!section) {
    if (pathname.startsWith('/account')) {
      const sub = ACCOUNT_SUB[pathname];
      return sub ? [{ label: '个人中心' }, { label: sub }] : [{ label: '个人中心' }];
    }
    return [];
  }
  // radar 运行历史 /radar/processes/:id/runs
  if (/^\/radar\/processes\/[^/]+\/runs$/.test(pathname)) {
    return [{ label: section.label, to: section.to }, { label: '运行记录' }];
  }
  // radar 运行详情 /radar/runs/:id
  if (/^\/radar\/runs\/[^/]+/.test(pathname)) {
    return [{ label: section.label, to: section.to }, { label: '运行详情' }];
  }
  if (/^\/insights\/[^/]+/.test(pathname) || /^\/posts\/[^/]+/.test(pathname)) {
    return [{ label: section.label, to: section.to }, { label: '详情' }];
  }
  return [{ label: section.label }];
}

/**
 * 上下文栏（对齐 shadcn dashboard-01 header 规范）：侧栏开关 + 短分隔 + 面包屑，
 * 右侧全局动作（⌘K 搜索 / 系统脉搏 / 主题）。内容与下方页面同一 max-w 容器对齐。
 * 面包屑即页面的可见标题（页内 PageHeader 大标题已撤），承担「我在哪」与导航返回。
 */
export function TopBar({ user }: { user: CurrentUser }) {
  const { pathname } = useLocation();
  const [cmdOpen, setCmdOpen] = useState(false);
  const crumbs = crumbsFor(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center rounded-t-xl border-b bg-background">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 px-4 sm:px-6 lg:px-8">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />

        {crumbs.length > 0 ? (
          <Breadcrumb>
            <BreadcrumbList className="gap-1 sm:gap-1.5">
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <Fragment key={c.label}>
                    <BreadcrumbItem>
                      {c.to && !last ? (
                        <BreadcrumbLink asChild>
                          <Link to={c.to}>{c.label}</Link>
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage className="font-medium">{c.label}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                    {!last ? <BreadcrumbSeparator /> : null}
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            aria-label="搜索 / 跳转（⌘K）"
            className="flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-transparent px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:pr-1.5"
          >
            <Search className="size-4 shrink-0" />
            <span className="hidden sm:inline">搜索</span>
            <kbd className="hidden shrink-0 items-center gap-px rounded border bg-muted px-1 py-0.5 font-mono text-[10px] font-medium leading-none sm:inline-flex">
              <Command className="size-2" aria-hidden="true" />K
            </kbd>
          </button>
          {can(user, 'insights:view') && pathname !== '/' ? <SystemPulse /> : null}
          <ModeToggle />
        </div>
      </div>

      <CommandPalette user={user} open={cmdOpen} onOpenChange={setCmdOpen} />
    </header>
  );
}
