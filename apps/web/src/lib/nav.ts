import {
  FileText,
  Gauge,
  LayoutDashboard,
  LayoutTemplate,
  Radar,
  Repeat,
  ScrollText,
  Settings2,
  Sparkles,
  Users,
  Workflow,
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

/** 导航分组（= RBAC 能力分组：工作区/运营/系统，详见 docs/web-redesign-design.md §4.2）。 */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * 全站导航的单一事实源 —— 侧边栏与命令面板（⌘K）共用。
 * 分组刻意对齐权限语义：数据浏览→工作区、运营操作→运营、系统管理→系统。
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
        to: '/radar',
        label: '指挥室',
        icon: Radar,
        perm: 'analyze:run',
        match: (p) => p.startsWith('/radar'),
      },
      {
        to: '/blueprints',
        label: '图纸',
        icon: LayoutTemplate,
        perm: 'analyze:run',
        match: (p) => p.startsWith('/blueprints'),
      },
      {
        to: '/processes',
        label: '进程',
        icon: Repeat,
        perm: 'analyze:run',
        match: (p) => p.startsWith('/processes'),
      },
      {
        to: '/analyze',
        label: '发起分析',
        icon: Zap,
        perm: 'analyze:run',
        match: (p) => p.startsWith('/analyze'),
      },
      {
        to: '/pipeline',
        label: '检视器',
        icon: Workflow,
        perm: 'analyze:run',
        match: (p) => p.startsWith('/pipeline'),
      },
      {
        to: '/requests',
        label: '请求闸',
        icon: Gauge,
        perm: 'analyze:run',
        match: (p) => p.startsWith('/requests'),
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
