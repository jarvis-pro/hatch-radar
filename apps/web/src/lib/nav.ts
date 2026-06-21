import {
  FileText,
  Gauge,
  LayoutDashboard,
  LayoutTemplate,
  Library,
  Lightbulb,
  Radar,
  ScrollText,
  Settings2,
  Sparkles,
  Users,
  Zap,
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

/** 导航分组（= RBAC 能力分组：工作区/运营/系统；「运营 · Mock」为 radar-lab 演示原型）。 */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * 全站导航的单一事实源 —— 侧边栏与命令面板（⌘K）共用。
 * 分组刻意对齐权限语义：数据浏览→工作区、运营操作→运营、系统管理→系统。
 * 「运营 · Mock」单列 radar-lab 的「活的模拟世界」演示（纯 mock，与上方真实运营页区隔）。
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
        to: '/insights',
        label: '需求洞察',
        icon: Sparkles,
        perm: 'insights:view',
        match: (p) => p.startsWith('/insights'),
      },
      {
        to: '/posts',
        label: '帖子库',
        icon: FileText,
        perm: 'posts:view',
        match: (p) => p.startsWith('/posts'),
      },
    ],
  },
  {
    label: '运营',
    items: [
      {
        to: '/analyze',
        label: '发起分析',
        icon: Zap,
        perm: 'analyze:run',
        match: (p) => p.startsWith('/analyze'),
      },
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
        to: '/radar/insights',
        label: '洞察库',
        icon: Lightbulb,
        perm: 'pipeline:run',
        match: (p) => p.startsWith('/radar/insights'),
      },
      {
        to: '/radar/posts',
        label: '帖子库',
        icon: Library,
        perm: 'pipeline:run',
        match: (p) => p.startsWith('/radar/posts'),
      },
      // 帖子一生（/radar/posts/:id）是纯详情，从运行详情 / 收成上下文点入，不占独立菜单位
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
