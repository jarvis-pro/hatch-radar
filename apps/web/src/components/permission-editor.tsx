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
 * 能力勾选编辑器（受控；账户新建/编辑表单内）。
 * - 按目录分组渲染，预设一键套用；
 * - grantable 限制非超管 actor 只能授予自己拥有的能力；
 * - disabled（编辑超管时）只读提示（隐式全通）。
 */
export function PermissionEditor({
  value,
  onChange,
  grantable,
  disabled,
}: {
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  /** 可授予集合；undefined = 不限（超管 actor）。 */
  grantable?: PermissionKey[];
  /** 编辑超管时禁用（隐式全通）。 */
  disabled?: boolean;
}) {
  const sel = new Set(value);
  const allowed = grantable ? new Set(grantable) : null;

  const toggle = (k: PermissionKey): void => {
    const next = new Set(sel);
    if (next.has(k)) {
      next.delete(k);
    } else {
      next.add(k);
    }
    onChange([...next]);
  };

  const applyPreset = (keys: readonly PermissionKey[]): void =>
    onChange(keys.filter((k) => !allowed || allowed.has(k)));

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
    </div>
  );
}
