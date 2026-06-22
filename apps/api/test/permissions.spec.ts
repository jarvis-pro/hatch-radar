import { describe, expect, it } from 'vitest';
import { hasPermission } from '@hatch-radar/shared';

/** 授权判定（纯函数，web/api 共用的单一实现）：super_admin 全通 / admin 看清单 / 停用拒绝。 */
describe('hasPermission（授权判定）', () => {
  it('super_admin 隐式全通（忽略授予清单）', () => {
    expect(hasPermission('super_admin', [], 'accounts:manage')).toBe(true);
    expect(hasPermission('super_admin', [], 'settings:manage')).toBe(true);
  });

  it('admin 仅在被授予该能力时通过', () => {
    expect(hasPermission('admin', ['insights:view'], 'insights:view')).toBe(true);
    expect(hasPermission('admin', ['insights:view'], 'accounts:manage')).toBe(false);
    expect(hasPermission('admin', [], 'insights:view')).toBe(false);
  });

  it('停用账户一律拒绝（即便 super_admin 或已授予该能力）', () => {
    expect(hasPermission('super_admin', [], 'accounts:manage', false)).toBe(false);
    expect(hasPermission('admin', ['insights:view'], 'insights:view', false)).toBe(false);
  });
});
