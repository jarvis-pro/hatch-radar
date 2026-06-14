'use client';

import { useState } from 'react';
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  PERMISSION_PRESETS,
  type PermissionKey,
} from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Checkbox } from '@hatch-radar/ui/components/checkbox';

/**
 * 能力勾选编辑器（账户新建/编辑表单内）。
 * - 按目录分组渲染，预设一键套用；
 * - grantable 限制非超管 actor 只能授予自己拥有的能力；
 * - disabled（编辑超管时）全勾且只读；选中项以隐藏 input(name="perm") 提交。
 */
export function PermissionEditor({
  initial,
  grantable,
  disabled,
}: {
  initial: PermissionKey[];
  /** 可授予集合；undefined = 不限（超管 actor）。 */
  grantable?: PermissionKey[];
  /** 编辑超管时禁用（隐式全通）。 */
  disabled?: boolean;
}) {
  const [sel, setSel] = useState<Set<PermissionKey>>(new Set(initial));
  const allowed = grantable ? new Set(grantable) : null;

  const toggle = (k: PermissionKey) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const applyPreset = (keys: readonly PermissionKey[]) =>
    setSel(new Set(keys.filter((k) => !allowed || allowed.has(k))));

  if (disabled) {
    return (
      <p className="text-sm text-muted-foreground">超级管理员隐式拥有全部能力，无需逐项配置。</p>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {PERMISSION_PRESETS.map((p) => (
          <Button
            key={p.id}
            type="button"
            variant="outline"
            size="sm"
            title={p.description}
            onClick={() => applyPreset(p.permissions)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {PERMISSION_GROUPS.map((group) => (
        <div key={group} className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">{group}</div>
          {PERMISSION_CATALOG.filter((c) => c.group === group).map((c) => {
            const blocked = allowed != null && !allowed.has(c.key);
            return (
              <label
                key={c.key}
                className="flex items-center gap-2 text-sm aria-disabled:opacity-50"
                aria-disabled={blocked || undefined}
              >
                <Checkbox
                  checked={sel.has(c.key)}
                  disabled={blocked}
                  onCheckedChange={() => toggle(c.key)}
                />
                <span>{c.label}</span>
                {c.sensitive ? (
                  <Badge variant="outline" className="text-[10px]">
                    敏感
                  </Badge>
                ) : null}
              </label>
            );
          })}
        </div>
      ))}

      {[...sel].map((k) => (
        <input key={k} type="hidden" name="perm" value={k} />
      ))}
    </div>
  );
}
