/**
 * 图纸实验室（原型）表单抽屉（底部 vaul Drawer，兼顾移动端）：
 * - BlueprintFormDialog —— 新建/编辑「图纸」（配方：kind + 来源 + 参数，**无节奏**）。
 * - ProcessFormDialog   —— 基于某图纸新建/编辑「进程」（节奏：单次/间隔/定时）。
 *
 * 每次打开经 useOpenKey 强制 body 重新挂载、从 props 重置 state（不依赖退场动画卸载时机）。
 */
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Wand2 } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@hatch-radar/ui/components/drawer';
import { Input } from '@hatch-radar/ui/components/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@hatch-radar/ui/components/input-group';
import { Label } from '@hatch-radar/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@hatch-radar/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';
import { Button } from '@hatch-radar/ui/components/button';
import { Switch } from '@hatch-radar/ui/components/switch';
import { toast } from '@hatch-radar/ui/components/sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@hatch-radar/ui/components/tooltip';
import { cn } from '@hatch-radar/ui/lib/utils';
import { useIsMobile } from '@hatch-radar/ui/hooks/use-mobile';
import {
  DEFAULT_COLLECT_PARAMS,
  DEFAULT_FLOW,
  DEFAULT_RECHECK_PARAMS,
  KIND_META,
  PARAM_HELP,
  SOURCE_META,
  TRIGGER_META,
} from './constants';
import { mockApi } from './mock';
import type {
  Blueprint,
  BlueprintKind,
  CollectParams,
  Process,
  RecheckParams,
  SourceKind,
  SourceSelection,
  TriggerConfig,
  TriggerKind,
} from './types';
import { KEYS, triggerSummary } from './util';

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** 秒 → 'HH:MM'（间隔时长 / 时刻共用）。 */
function secondsToHHMM(sec: number): string {
  return `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}`;
}
/** 'HH:MM' → 秒。 */
function hhmmToSeconds(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => Number(x) || 0);
  return h * 3600 + m * 60;
}
/** 从「每天 HH:MM」式表达式取出 HH:MM；取不到给默认。 */
function cronTimeOf(expr: string): string {
  const m = /(\d{1,2}):(\d{2})/.exec(expr);
  return m ? `${pad2(Number(m[1]))}:${m[2]}` : '09:00';
}

// Reddit 暂不打算用，放末位；列表首项作为新建时的默认启用源。
const SOURCE_KINDS: SourceKind[] = ['hackernews', 'rss', 'reddit'];

/**
 * 每次「打开」自增的 key —— 强制表单 body 重新挂载、状态重置。
 * 规避 Radix 退场动画期内容尚未卸载、快速重开会复用旧 state 的问题（渲染期调整 state，无闪烁）。
 */
function useOpenKey(open: boolean): number {
  const [key, setKey] = useState(0);
  const [was, setWas] = useState(false);
  if (open !== was) {
    setWas(open);
    if (open) setKey((k) => k + 1);
  }
  return key;
}

/** 小号带标签数字输入。 */
function NumberField({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.round(e.target.valueAsNumber || 0)))}
      />
    </div>
  );
}

// ─── 图纸表单 ─────────────────────────────────────────────────────────────────

type SourceDraft = Record<SourceKind, { enabled: boolean; channels: string }>;

function initSources(editing?: Blueprint): SourceDraft {
  const base: SourceDraft = {
    reddit: { enabled: false, channels: '' },
    hackernews: { enabled: false, channels: '' },
    rss: { enabled: false, channels: '' },
  };
  if (editing) {
    for (const s of editing.sources)
      base[s.kind] = { enabled: true, channels: s.channels.join(', ') };
  } else {
    base[SOURCE_KINDS[0]!] = { enabled: true, channels: '' };
  }
  return base;
}

function BlueprintFormBody({
  editing,
  onDone,
}: {
  editing?: Blueprint;
  onDone: (createdId?: string) => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(editing?.label ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [kind, setKind] = useState<BlueprintKind>(editing?.kind ?? 'collect');
  const [sources, setSources] = useState<SourceDraft>(() => initSources(editing));
  const [collect, setCollect] = useState<CollectParams>(
    editing?.kind === 'collect' ? (editing.params as CollectParams) : DEFAULT_COLLECT_PARAMS,
  );
  const [recheck, setRecheck] = useState<RecheckParams>(
    editing?.kind === 'recheck' ? (editing.params as RecheckParams) : DEFAULT_RECHECK_PARAMS,
  );
  const [saving, setSaving] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);

  const enabledKinds = SOURCE_KINDS.filter((k) => sources[k].enabled);

  /** 整表校验：点「提交」时跑一遍；首次提交后随编辑实时反馈。 */
  function computeErrors(): { label?: string; sources?: string; channels?: string } {
    const e: { label?: string; sources?: string; channels?: string } = {};
    if (!label.trim()) e.label = '请填写图纸名称';
    if (enabledKinds.length === 0) e.sources = '至少选择一个数据源';
    if (enabledKinds.some((k) => !sources[k].channels.trim()))
      e.channels = '已启用的数据源需填写频道';
    return e;
  }
  const errors = triedSubmit ? computeErrors() : {};

  async function submit(): Promise<void> {
    setTriedSubmit(true);
    if (Object.keys(computeErrors()).length > 0) return; // 校验未过：留在表单、内联标错
    const trimmed = label.trim();
    const selected: SourceSelection[] = enabledKinds.map((k) => ({
      kind: k,
      channels: sources[k].channels
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    }));

    setSaving(true);
    try {
      const params = kind === 'collect' ? collect : recheck;
      let createdId: string | undefined;
      if (editing) {
        await mockApi.updateBlueprint(editing.id, {
          label: trimmed,
          note: note.trim() || undefined,
          kind,
          sources: selected,
          params,
          // 改了种类则流程重置为新种类的默认脚手架（旧环节对新 kind 不适用）；否则保留已编辑流程。
          ...(kind !== editing.kind ? { flow: DEFAULT_FLOW[kind] } : {}),
        });
      } else {
        const created = await mockApi.createBlueprint({
          kind,
          label: trimmed,
          note: note.trim() || undefined,
          sources: selected,
          params,
          flow: DEFAULT_FLOW[kind],
        });
        createdId = created.id;
      }
      // 先 await 刷新列表，再 onDone 切换选中：否则「自动选中新建项」会被列表收敛 effect 拉回首项
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.blueprints }),
        qc.invalidateQueries({ queryKey: KEYS.counts }),
      ]);
      toast.success(editing ? '图纸已更新' : '图纸已创建');
      onDone(createdId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <TooltipProvider>
      <DrawerHeader className="shrink-0 text-left">
        <DrawerTitle>{editing ? '编辑图纸' : '新建图纸'}</DrawerTitle>
        <DrawerDescription>
          图纸是「配方」：抓哪些源、采集还是复查、各项参数 —— 不含运行节奏（节奏在进程上设）。
        </DrawerDescription>
      </DrawerHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2">
        <div className="space-y-1.5">
          <Label htmlFor="bp-label">名称</Label>
          <Input
            id="bp-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="请输入图纸名称"
            aria-invalid={!!errors.label}
          />
          {errors.label ? <p className="text-sm text-destructive">{errors.label}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bp-note">说明（可选）</Label>
          <Input
            id="bp-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="请输入图纸说明"
          />
        </div>

        <div className="space-y-2">
          <Label>类型</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['collect', 'recheck'] as BlueprintKind[]).map((k) => {
              const meta = KIND_META[k];
              const Icon = meta.icon;
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border-2 p-3 text-left transition-colors',
                    active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                  )}
                >
                  <Icon
                    className={cn(
                      'mt-0.5 size-4',
                      active ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{meta.label}</div>
                    <div className="text-xs text-muted-foreground">{meta.blurb}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>数据源</Label>
            {errors.sources ? (
              <span className="text-sm text-destructive">{errors.sources}</span>
            ) : null}
          </div>
          <div className="space-y-2">
            {SOURCE_KINDS.map((k) => {
              const meta = SOURCE_META[k];
              const Icon = meta.icon;
              const draft = sources[k];
              const channelError = triedSubmit && draft.enabled && !draft.channels.trim();
              return (
                <div key={k} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{meta.label}</span>
                    </div>
                    <Switch
                      checked={draft.enabled}
                      disabled={enabledKinds.length === 1 && draft.enabled}
                      onCheckedChange={(v) =>
                        setSources((s) => ({ ...s, [k]: { ...s[k], enabled: v } }))
                      }
                    />
                  </div>
                  {draft.enabled ? (
                    <div className="mt-2 space-y-1">
                      <InputGroup>
                        <InputGroupAddon align="inline-start" className="text-foreground">
                          {meta.channelLabel}
                        </InputGroupAddon>
                        <InputGroupInput
                          value={draft.channels}
                          aria-invalid={channelError}
                          onChange={(e) =>
                            setSources((s) => ({
                              ...s,
                              [k]: { ...s[k], channels: e.target.value },
                            }))
                          }
                          placeholder={meta.placeholder}
                        />
                        <InputGroupAddon align="inline-end">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <InputGroupButton
                                size="icon-xs"
                                aria-label="填入推荐预设"
                                onClick={() =>
                                  setSources((s) => ({
                                    ...s,
                                    [k]: { ...s[k], channels: meta.defaultChannels.join(', ') },
                                  }))
                                }
                              >
                                <Wand2 />
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent>填入推荐预设</TooltipContent>
                          </Tooltip>
                        </InputGroupAddon>
                      </InputGroup>
                      {channelError ? (
                        <p className="text-xs text-destructive">
                          请填写{meta.channelLabel}（不可为空）
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label>{kind === 'collect' ? '采集参数' : '复查参数'}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="参数说明"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Info className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="z-[60] w-80">
                <p className="mb-2 text-sm font-medium">
                  {kind === 'collect' ? '采集参数说明' : '复查参数说明'}
                </p>
                <ul className="space-y-1.5 text-sm">
                  {PARAM_HELP[kind].map((h) => (
                    <li key={h.label}>
                      <span className="font-medium text-foreground">{h.label}</span>
                      <span className="text-muted-foreground">：{h.desc}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </div>
          {kind === 'collect' ? (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                采集沿 <span className="font-mono">new</span> 时间线增量翻页发现新帖 —— new
                对发现是完备的（每条新帖都会流经 new），无需多排序维度；帖子后续的热度 /
                评论变化交由「复查」按需重抓。
              </p>
              <div className="grid grid-cols-3 gap-3">
                <NumberField
                  label="翻页上限"
                  value={collect.limit}
                  onChange={(n) => setCollect((c) => ({ ...c, limit: n }))}
                  min={1}
                />
                <NumberField
                  label="连续命中即停"
                  value={collect.stopAfterKnown}
                  onChange={(n) => setCollect((c) => ({ ...c, stopAfterKnown: n }))}
                  min={1}
                />
                <NumberField
                  label="评论预算"
                  value={collect.commentBudget}
                  onChange={(n) => setCollect((c) => ({ ...c, commentBudget: n }))}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 rounded-lg border p-3">
              <NumberField
                label="每批帖数"
                value={recheck.batchSize}
                onChange={(n) => setRecheck((r) => ({ ...r, batchSize: n }))}
                min={1}
              />
              <NumberField
                label="批间冷却(秒)"
                value={recheck.batchIntervalSec}
                onChange={(n) => setRecheck((r) => ({ ...r, batchIntervalSec: n }))}
                min={1}
              />
              <NumberField
                label="退避封顶(轮)"
                value={recheck.backoffCap}
                onChange={(n) => setRecheck((r) => ({ ...r, backoffCap: n }))}
                min={1}
              />
            </div>
          )}
        </div>
      </div>

      <DrawerFooter className="shrink-0 flex-row justify-end gap-2">
        <Button variant="outline" onClick={() => onDone()} disabled={saving}>
          取消
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? '保存中…' : editing ? '保存' : '创建图纸'}
        </Button>
      </DrawerFooter>
    </TooltipProvider>
  );
}

/** 图纸新建/编辑弹窗。 */
export function BlueprintFormDialog({
  open,
  onOpenChange,
  editing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: Blueprint;
  onCreated?: (id: string) => void;
}) {
  const bodyKey = useOpenKey(open);
  const isMobile = useIsMobile();
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={isMobile ? 'bottom' : 'right'}>
      <DrawerContent className="data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col overflow-hidden">
          <BlueprintFormBody
            key={bodyKey}
            editing={editing}
            onDone={(createdId) => {
              if (createdId) onCreated?.(createdId);
              onOpenChange(false);
            }}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ─── 进程表单 ─────────────────────────────────────────────────────────────────

function ProcessFormBody({
  blueprints,
  editing,
  onDone,
}: {
  blueprints: Blueprint[];
  editing?: Process;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [blueprintId, setBlueprintId] = useState(editing?.blueprintId ?? blueprints[0]?.id ?? '');
  const blueprint = blueprints.find((b) => b.id === blueprintId);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [triggerKind, setTriggerKind] = useState<TriggerKind>(editing?.trigger.kind ?? 'interval');
  const [intervalTime, setIntervalTime] = useState(
    secondsToHHMM(editing?.trigger.kind === 'interval' ? editing.trigger.everySec : 30 * 60),
  );
  const [cronTime, setCronTime] = useState(
    editing?.trigger.kind === 'cron' ? cronTimeOf(editing.trigger.expr) : '09:00',
  );
  const [saving, setSaving] = useState(false);

  function buildTrigger(): TriggerConfig {
    if (triggerKind === 'once') return { kind: 'once' };
    if (triggerKind === 'cron') return { kind: 'cron', expr: `每天 ${cronTime || '09:00'}` };
    return { kind: 'interval', everySec: Math.max(60, hhmmToSeconds(intervalTime)) };
  }

  async function submit(): Promise<void> {
    if (!blueprint) return;
    setSaving(true);
    try {
      const trigger = buildTrigger();
      const finalLabel = label.trim() || `${blueprint.label} · ${triggerSummary(trigger)}`;
      if (editing) {
        await mockApi.updateProcess(editing.id, { label: finalLabel, trigger });
        toast.success('进程已更新');
      } else {
        await mockApi.createProcess({ blueprintId: blueprint.id, label: finalLabel, trigger });
        toast.success('进程已创建并开始调度');
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.allProcesses }),
        qc.invalidateQueries({ queryKey: KEYS.counts }),
      ]);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DrawerHeader className="shrink-0 text-left">
        <DrawerTitle>{editing ? '编辑进程' : '新建进程'}</DrawerTitle>
        <DrawerDescription>
          {editing
            ? '调整进程名与运行节奏（所属图纸不变）。'
            : '选一张图纸、设定运行节奏；同一图纸可建多个不同节奏的进程。'}
        </DrawerDescription>
      </DrawerHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2">
        <div className="space-y-1.5">
          <Label>图纸</Label>
          <Select value={blueprintId} onValueChange={setBlueprintId} disabled={!!editing}>
            <SelectTrigger className="w-full *:data-[slot=select-value]:min-w-0">
              <SelectValue placeholder="选择图纸" />
            </SelectTrigger>
            <SelectContent>
              {blueprints.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {KIND_META[b.kind].label} · {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editing ? (
            <p className="text-xs text-muted-foreground">进程创建后，所属图纸不可更改。</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pr-label">进程名（留空自动生成）</Label>
          <Input
            id="pr-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="请输入进程名称"
          />
        </div>

        <div className="space-y-2">
          <Label>节奏</Label>
          {/* 选择器 + 配置合为一张卡片：顶部分段三选一、底部随选项展开配置 —— */}
          {/* 走表单内既有的 border 盒子语言，去掉原先突兀的独立灰底块，让节奏回归「一个字段块」。 */}
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-3">
              {(['once', 'interval', 'cron'] as TriggerKind[]).map((k, i) => {
                const m = TRIGGER_META[k];
                const Icon = m.icon;
                const active = triggerKind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTriggerKind(k)}
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors',
                      i > 0 && 'border-l',
                      active
                        ? 'bg-primary/5 text-primary'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    {m.label}
                  </button>
                );
              })}
            </div>

            <div className="border-t p-3">
              {triggerKind === 'once' ? (
                <p className="text-sm text-muted-foreground">{TRIGGER_META.once.hint}</p>
              ) : triggerKind === 'interval' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">每隔</span>
                    <Input
                      type="time"
                      value={intervalTime}
                      onChange={(e) => setIntervalTime(e.target.value)}
                      className="w-32 dark:[&::-webkit-calendar-picker-indicator]:invert"
                    />
                    <span className="text-muted-foreground">跑一次</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{TRIGGER_META.interval.hint}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">每天</span>
                    <Input
                      type="time"
                      value={cronTime}
                      onChange={(e) => setCronTime(e.target.value)}
                      className="w-32 dark:[&::-webkit-calendar-picker-indicator]:invert"
                    />
                    <span className="text-muted-foreground">触发</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{TRIGGER_META.cron.hint}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DrawerFooter className="shrink-0 flex-row justify-end gap-2">
        <Button variant="outline" onClick={() => onDone()} disabled={saving}>
          取消
        </Button>
        <Button onClick={() => void submit()} disabled={saving || !blueprint}>
          {saving ? '保存中…' : editing ? '保存' : '创建进程'}
        </Button>
      </DrawerFooter>
    </>
  );
}

/** 进程新建/编辑弹窗。 */
export function ProcessFormDialog({
  open,
  onOpenChange,
  blueprints,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blueprints: Blueprint[];
  editing?: Process;
}): ReactNode {
  const bodyKey = useOpenKey(open);
  const isMobile = useIsMobile();
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={isMobile ? 'bottom' : 'right'}>
      <DrawerContent className="data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col overflow-hidden">
          <ProcessFormBody
            key={bodyKey}
            blueprints={blueprints}
            editing={editing}
            onDone={() => onOpenChange(false)}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
