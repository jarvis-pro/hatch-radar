/**
 * 账户系统的角色与能力目录（单一事实源）。
 *
 * 纯类型与常量、零运行时依赖——web / server / mobile 共用：web/server 据此做服务端授权，
 * mobile 据此做 UI 显隐。能力 key 在此登记即可，无需 DB 迁移（库里 user_permissions.permission 为 String）。
 */

/** 系统角色：super_admin 隐式全通；admin 能力来自被授予的清单。 */
export type UserRole = 'super_admin' | 'admin';

/** 能力分组（UI 显示分区）。 */
export type PermissionGroup = '数据浏览' | '研判' | '运营操作' | '系统管理';

/** 全部能力 key（资源:动作）。新增能力在此追加即可。 */
export const PERMISSION_KEYS = [
  'insights:view',
  'posts:view',
  'insights:triage',
  'analyze:run',
  'pipeline:run',
  'pipeline:control',
  'requests:control',
  'export:run',
  'settings:manage',
  'audit:view',
  'accounts:manage',
] as const;

/** 能力 key 字面量联合类型。 */
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** 单个能力的元数据。 */
export interface PermissionMeta {
  key: PermissionKey;
  /** 中文展示名。 */
  label: string;
  /** UI 分组。 */
  group: PermissionGroup;
  /** 敏感能力（密钥/计费/账户/审计）：UI 单独成组、授予前二次确认。 */
  sensitive: boolean;
}

/** 能力目录：渲染顺序即此数组顺序。 */
export const PERMISSION_CATALOG: readonly PermissionMeta[] = [
  { key: 'insights:view', label: '查看洞察', group: '数据浏览', sensitive: false },
  { key: 'posts:view', label: '查看帖子与评论', group: '数据浏览', sensitive: false },
  { key: 'insights:triage', label: '研判（状态/评级/标签/笔记）', group: '研判', sensitive: false },
  { key: 'analyze:run', label: '触发 AI 分析（计费）', group: '运营操作', sensitive: true },
  { key: 'pipeline:run', label: '触发进程 / 发起运行', group: '运营操作', sensitive: false },
  {
    key: 'pipeline:control',
    label: '运行控制（放行 / 重试 / 取消 / 图纸·进程编辑）',
    group: '运营操作',
    sensitive: false,
  },
  {
    key: 'requests:control',
    label: '请求闸 lane 暂停 / 恢复',
    group: '运营操作',
    sensitive: false,
  },
  { key: 'export:run', label: '导出 / 拉取批次', group: '运营操作', sensitive: false },
  { key: 'settings:manage', label: '模型与密钥管理', group: '系统管理', sensitive: true },
  { key: 'audit:view', label: '查看审计日志', group: '系统管理', sensitive: true },
  { key: 'accounts:manage', label: '账户 / 权限 / 设备管理', group: '系统管理', sensitive: true },
];

/** 分组渲染顺序。 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  '数据浏览',
  '研判',
  '运营操作',
  '系统管理',
];

/** 能力 key → 元数据 的索引。 */
export const PERMISSION_META = Object.fromEntries(
  PERMISSION_CATALOG.map((p) => [p.key, p]),
) as Record<PermissionKey, PermissionMeta>;

/** 权限预设：新建管理员的勾选模板。 */
export interface PermissionPreset {
  id: string;
  label: string;
  description: string;
  permissions: readonly PermissionKey[];
}

/** 新建普通管理员默认套用的能力集（= 研判员预设）。 */
export const DEFAULT_ADMIN_PERMISSIONS: readonly PermissionKey[] = [
  'insights:view',
  'posts:view',
  'insights:triage',
];

/** 可选的命名预设；「自定义」为空白，逐项勾选。 */
export const PERMISSION_PRESETS: readonly PermissionPreset[] = [
  {
    id: 'triager',
    label: '研判员',
    description: '看洞察 + 看帖子 + 研判（默认）',
    permissions: DEFAULT_ADMIN_PERMISSIONS,
  },
  {
    id: 'observer',
    label: '只读观察者',
    description: '只看洞察与帖子，不可研判',
    permissions: ['insights:view', 'posts:view'],
  },
  { id: 'custom', label: '自定义', description: '空白，逐项勾选', permissions: [] },
];

/** 校验字符串是否为合法能力 key（入库取值的应用层约束）。 */
export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/**
 * 授权判定（单一实现，web/server 共用）。
 * - 停用账户：一律拒绝；
 * - super_admin：隐式全通（忽略 granted）；
 * - admin：看被授予的能力清单。
 * @param role 用户系统角色
 * @param granted 被授予的能力集（admin 用；super_admin 可传空）
 * @param key 待校验能力
 * @param active 账户是否启用（默认 true）
 */
export function hasPermission(
  role: UserRole,
  granted: readonly string[],
  key: PermissionKey,
  active = true,
): boolean {
  if (!active) {
    return false;
  }
  if (role === 'super_admin') {
    return true;
  }
  return granted.includes(key);
}
