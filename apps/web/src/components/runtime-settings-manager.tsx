import { useEffect, useState } from 'react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { toast } from '@hatch-radar/ui/components/sonner';
import { api, ApiError } from '@/api/client';
import { LoadError } from '@/components/empty';

/** 运行期参数键（与 server RuntimeSettingKey 对应） */
export type RuntimeSettingKey =
  | 'analyzeBatchSize'
  | 'sessionIdleDays'
  | 'sessionAbsoluteDays'
  | 'workerJobTimeoutMs'
  | 'workerStaleSeconds';

/** 单项有效态（与 server RuntimeFieldState 对应） */
export interface RuntimeFieldState {
  value: number;
  defaultValue: number;
}

/** 运行期设置数据（来自 server GET /api/settings/runtime） */
export type RuntimeSettingsData = Record<RuntimeSettingKey, RuntimeFieldState>;

interface FieldMeta {
  key: RuntimeSettingKey;
  label: string;
  hint: string;
  /** 整数下界（与 server zod 约束一致，前端先行拦截） */
  min: number;
  unit: string;
  group: string;
}

/** 字段元数据：分组 / 文案 / 单位 / 下界（渲染与校验共用） */
const FIELD_META: FieldMeta[] = [
  {
    key: 'analyzeBatchSize',
    label: '每轮分析批次上限',
    hint: '每小时定时入队送 AI 分析的帖子数上限',
    min: 1,
    unit: '篇/轮',
    group: '分析',
  },
  {
    key: 'sessionIdleDays',
    label: '会话空闲过期窗',
    hint: '活跃即滑动续期到 now + 此值',
    min: 1,
    unit: '天',
    group: '会话',
  },
  {
    key: 'sessionAbsoluteDays',
    label: '会话绝对过期窗',
    hint: '自创建起的硬上限，续期不得超过',
    min: 1,
    unit: '天',
    group: '会话',
  },
  {
    key: 'workerJobTimeoutMs',
    label: '单 job 硬超时',
    hint: '单条分析任务超过即中止并计失败',
    min: 1000,
    unit: '毫秒',
    group: 'Worker',
  },
  {
    key: 'workerStaleSeconds',
    label: '僵死回收阈值',
    hint: 'running 心跳超此值视为僵死并回收（须 > 15s 心跳）',
    min: 30,
    unit: '秒',
    group: 'Worker',
  },
];

/** 分组顺序（去重保序） */
const GROUPS = [...new Set(FIELD_META.map((f) => f.group))];

/** 由有效态生成草稿：每项填入当前 DB 值（这些参数已首启播种，始终有值） */
function seedDraft(data: RuntimeSettingsData): Record<RuntimeSettingKey, string> {
  const out = {} as Record<RuntimeSettingKey, string>;
  for (const f of FIELD_META) {
    out[f.key] = String(data[f.key].value);
  }
  return out;
}

/**
 * 运行期参数：分析批次 / 会话时长 / worker 调优。值存 DB（首启播种默认值），保存即时生效、无需重启。
 * 「恢复默认」把输入填回出厂默认。仅提交相对当前态有改动的字段。
 * 同源直连 /api/settings/runtime（cookie + CSRF）；变更后 onChanged() 触发页面重新拉取。
 */
export function RuntimeSettingsManager({
  initial,
  loadError,
  onChanged,
}: {
  initial: RuntimeSettingsData | null;
  loadError: string | null;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Record<RuntimeSettingKey, string>>(() =>
    initial ? seedDraft(initial) : ({} as Record<RuntimeSettingKey, string>),
  );
  const [busy, setBusy] = useState(false);

  // 重新拉取（保存后 / 切换）时把草稿同步到最新有效态；编辑期间 initial 引用稳定，不打断输入
  useEffect(() => {
    if (initial) {
      setDraft(seedDraft(initial));
    }
  }, [initial]);

  if (loadError || !initial) {
    return <LoadError message={loadError ?? undefined} />;
  }
  const data = initial;

  function set(key: RuntimeSettingKey, v: string) {
    setDraft((d) => ({ ...d, [key]: v }));
  }

  async function save() {
    const patch: Partial<Record<RuntimeSettingKey, number>> = {};
    for (const f of FIELD_META) {
      const cur = draft[f.key].trim();
      if (cur === String(data[f.key].value)) {
        continue;
      } // 相对当前态无改动 → 不提交
      const n = Number(cur);
      if (cur === '' || !Number.isInteger(n) || n < f.min) {
        toast.error(`「${f.label}」需为 ≥ ${f.min} 的整数`);
        return;
      }
      patch[f.key] = n;
    }
    if (Object.keys(patch).length === 0) {
      toast.info('没有改动');
      return;
    }
    setBusy(true);
    try {
      await api.put('/settings/runtime', patch);
      toast.success('已保存，立即生效');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">运行期参数</h2>
        <p className="text-sm text-muted-foreground">
          分析批次、会话时长、worker 调优。值存数据库（首启播种默认值），保存即时生效，无需重启。
        </p>
      </div>

      <div className="space-y-7">
        {GROUPS.map((group) => (
          <section key={group}>
            <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground">
              {group}
            </h3>
            {FIELD_META.filter((f) => f.group === group).map((f) => {
              const state = data[f.key];
              const changedFromDefault = state.value !== state.defaultValue;
              const atDefault = draft[f.key].trim() === String(state.defaultValue);
              return (
                <div
                  key={f.key}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`rs-${f.key}`}>{f.label}</Label>
                      {changedFromDefault ? <Badge variant="secondary">已改</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {f.hint} · 默认 {state.defaultValue}
                      {f.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`rs-${f.key}`}
                      type="number"
                      min={f.min}
                      value={draft[f.key]}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="w-28 font-mono"
                    />
                    <span className="w-10 text-xs text-muted-foreground">{f.unit}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={atDefault}
                      onClick={() => set(f.key, String(state.defaultValue))}
                    >
                      恢复默认
                    </Button>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </Button>
      </div>
    </div>
  );
}
