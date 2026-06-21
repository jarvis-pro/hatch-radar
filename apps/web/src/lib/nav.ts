import {
  Gauge,
  LayoutDashboard,
  LayoutTemplate,
  Library,
  Lightbulb,
  Radar,
  ScrollText,
  Settings2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionKey } from '@hatch-radar/shared';

/** 单个导航项：路径 + 标签 + 图标 + 所需能力（无权则不显示）+ 区段高亮匹配。 */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm: PermissionKey;
  /** 当前路径是否落在本项区段（用于高亮） */
  match: (pathname: string) => boolean;
}

/** 导航分组（= RBAC 能力分组：工作区＝数据浏览 / 运营＝操作控制 / 系统＝管理）。 */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * 全站导航的单一事实源 —— 侧边栏与命令面板（⌘K）共用。
 * 分组刻意对齐权限语义：数据浏览→工作区、运营操作→运营、系统管理→系统。
 * 「数据看板 / 洞察库 / 帖子库」是回顾分析与研判的浏览面（insights:view / posts:view）；
 * 「指挥室 / 图纸 / 请求闸」是实时操作面（pipeline:run / requests:control）。
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: '工作区',
    items: [
      {
        to: '/',
        label: '数据看板',
        icon: LayoutDashboard,
        perm: 'insights:view',
        match: (p) => p === '/',
      },
      {
        to: '/radar/insights',
        label: '洞察库',
        icon: Lightbulb,
        perm: 'insights:view',
        match: (p) => p.startsWith('/radar/insights'),
      },
      {
        to: '/radar/posts',
        label: '帖子库',
        icon: Library,
        perm: 'posts:view',
        match: (p) => p.startsWith('/radar/posts'),
      },
    ],
  },
  {
    label: '运营',
    items: [
      {
        to: '/radar',
        label: '指挥室',
        icon: Radar,
        perm: 'pipeline:run',
        // 枢纽 + 运行详情 / 运行历史（其余 radar 子页各自高亮）
        match: (p) =>
          p === '/radar' || p.startsWith('/radar/runs') || p.startsWith('/radar/processes'),
      },
      {
        to: '/radar/blueprints',
        label: '图纸',
        icon: LayoutTemplate,
        perm: 'pipeline:run',
        match: (p) => p.startsWith('/radar/blueprints'),
      },
      {
        to: '/radar/requests',
        label: '请求闸',
        icon: Gauge,
        perm: 'requests:control',
        match: (p) => p.startsWith('/radar/requests'),
      },
    ],
  },
  {
    label: '系统',
    items: [
      {
        to: '/settings',
        label: '系统设置',
        icon: Settings2,
        perm: 'settings:manage',
        match: (p) => p.startsWith('/settings'),
      },
      {
        to: '/admin/accounts',
        label: '账户管理',
        icon: Users,
        perm: 'accounts:manage',
        match: (p) => p.startsWith('/admin/accounts'),
      },
      {
        to: '/admin/audit',
        label: '审计日志',
        icon: ScrollText,
        perm: 'audit:view',
        match: (p) => p.startsWith('/admin/audit'),
      },
    ],
  },
];
