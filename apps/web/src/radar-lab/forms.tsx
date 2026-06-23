/**
 * 图纸 / 进程 表单（radar-lab）—— 闭环的「定义」端，经 react-query mutation 写 /api。
 * - BlueprintForm：配方（kind + 源/频道 + 参数），无节奏。
 * - ProcessForm：基于某图纸的节奏（单次/间隔/定时）+ 启停常驻。
 */
import { useState, type ReactNode } from 'react';
import { Info, Wand2 } from 'lucide-react';
import type {
  BlueprintDTO,
  BlueprintKind,
  ProcessDTO,
  RadarSourceKind,
  TriggerConfig,
} from '@hatch-radar/shared';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@hatch-radar/ui/components/drawer';
import { Input } from '@hatch-radar/ui/components/input';
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
import { cn } from '@hatch-radar/ui/lib/utils';
import { useIsMobile } from '@hatch-radar/ui/hooks/use-mobile';
import {
  DEFAULT_COLLECT_PARAMS,
  DEFAULT_RECHECK_PARAMS,
  KIND_META,
  SOURCE_META,
  TRIGGER_META,
} from './constants';
import {
  useCreateBlueprint,
  useCreateProcess,
  useUpdateBlueprint,
  useUpdateProcess,
} from './mutations';
import type { CollectParams, RecheckParams, TriggerKind } from './types';
import { triggerSummary } from './util';

type SourceKind = RadarSourceKind;

const SOURCE_KINDS: SourceKind[] = ['reddit', 'hackernews', 'rss'];
const SOURCE_FORM: Record<
  SourceKind,
  { channelLabel: string; placeholder: string; preset: string[] }
> = {
  reddit: {
    channelLabel: '版块',
    placeholder: 'r/SaaS, r/startups',
    preset: ['r/SaaS', 'r/startups', 'r/Entrepreneur'],
  },
  hackernews: { channelLabel: '列表', placeholder: 'front, new', preset: ['front', 'new'] },
  rss: {
    channelLabel: '订阅',
    placeholder: 'TechCrunch, Hacker Newsletter',
    preset: ['TechCrunch', 'Hacker Newsletter'],
  },
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

type IntervalUnit = 'sec' | 'min' | 'hour';
const UNIT_SEC: Record<IntervalUnit, number> = { sec: 1, min: 60, hour: 3600 };
const INTERVAL_UNITS: { value: IntervalUnit; label: string }[] = [
  { value: 'sec', label: '秒' },
  { value: 'min', label: '分钟' },
  { value: 'hour', label: '小时' },
];
/** 把 everySec 拆成最自然的「值 + 单位」（能整除优先 时 > 分 > 秒）——避免秒级间隔被时间输入取整丢失。 */
function splitInterval(everySec: number): { value: number; unit: IntervalUnit } {
  if (everySec > 0 && everySec % 3600 === 0) {
    return { value: everySec / 3600, unit: 'hour' };
  }

  if (everySec > 0 && everySec % 60 === 0) {
    return { value: everySec / 60, unit: 'min' };
  }

  return { value: everySec, unit: 'sec' };
}

const cronTimeOf = (expr: string): string => {
  const m = /(\d{1,2}):(\d{2})/.exec(expr);

  return m ? `${pad2(Number(m[1]))}:${m[2]}` : '09:00';
};

/** 每次「打开」自增 key，强制 body 重挂、状态从 props 重置。 */
function useOpenKey(open: boolean): number {
  const [key, setKey] = useState(0);
  const [was, setWas] = useState(false);
  if (open !== was) {
    setWas(open);
    if (open) {
      setKey((k) => k + 1);
    }
  }

  return key;
}

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

// ─── 图纸表单 ──────────────────────────────────────────────────────────────────

type SourceDraft = Record<SourceKind, { enabled: boolean; channels: string }>;

function initSources(editing?: BlueprintDTO): SourceDraft {
  const base: SourceDraft = {
    reddit: { enabled: false, channels: '' },
    hackernews: { enabled: false, channels: '' },
    rss: { enabled: false, channels: '' },
  };
  if (editing) {
    for (const s of editing.sources) {
      base[s.kind] = { enabled: true, channels: s.channels.join(', ') };
    }
  } else {
    base.reddit = { enabled: true, channels: '' };
  }

  return base;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

/** 从图纸 params（Record）读出采集 / 复查参数，缺省回退默认。 */
function readCollect(editing?: BlueprintDTO): CollectParams {
  if (editing?.kind !== 'collect') {
    return DEFAULT_COLLECT_PARAMS;
  }

  const p = editing.params;

  return {
    limit: num(p.limit, DEFAULT_COLLECT_PARAMS.limit),
    stopAfterKnown: num(p.stopAfterKnown, DEFAULT_COLLECT_PARAMS.stopAfterKnown),
    commentBudget: num(p.commentBudget, DEFAULT_COLLECT_PARAMS.commentBudget),
  };
}

function readRecheck(editing?: BlueprintDTO): RecheckParams {
  if (editing?.kind !== 'recheck') {
    return DEFAULT_RECHECK_PARAMS;
  }

  const p = editing.params;

  return {
    batchSize: num(p.batchSize, DEFAULT_RECHECK_PARAMS.batchSize),
    batchIntervalSec: num(p.batchIntervalSec, DEFAULT_RECHECK_PARAMS.batchIntervalSec),
    backoffCap: num(p.backoffCap, DEFAULT_RECHECK_PARAMS.backoffCap),
  };
}

function BlueprintBody({
  editing,
  onDone,
}: {
  editing?: BlueprintDTO;
  onDone: (id?: number) => void;
}) {
  const create = useCreateBlueprint();
  const update = useUpdateBlueprint();
  const [label, setLabel] = useState(editing?.label ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [kind, setKind] = useState<BlueprintKind>(editing?.kind ?? 'collect');
  const [sources, setSources] = useState<SourceDraft>(() => initSources(editing));
  const [collect, setCollect] = useState<CollectParams>(() => readCollect(editing));
  const [recheck, setRecheck] = useState<RecheckParams>(() => readRecheck(editing));
  const [tried, setTried] = useState(false);
  const enabled = SOURCE_KINDS.filter((k) => sources[k].enabled);
  const busy = create.isPending || update.isPending;

  function errs(): { label?: boolean; sources?: boolean; channels?: boolean } {
    return {
      label: !label.trim(),
      sources: enabled.length === 0,
      channels: enabled.some((k) => !sources[k].channels.trim()),
    };
  }

  const e = tried ? errs() : {};

  function submit(): void {
    setTried(true);
    const x = errs();
    if (x.label || x.sources || x.channels) {
      return;
    }

    const selected = enabled.map((k) => ({
      kind: k,
      channels: sources[k].channels
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    }));
    const params = (kind === 'collect' ? collect : recheck) as unknown as Record<string, unknown>;
    if (editing) {
      update.mutate(
        {
          id: editing.id,
          label: label.trim(),
          note: note.trim() || null,
          kind,
          sources: selected,
          params,
        },
        { onSuccess: () => onDone() },
      );
    } else {
      create.mutate(
        {
          kind,
          label: label.trim(),
          note: note.trim() || null,
          sources: selected,
          params,
        },
        { onSuccess: (b) => onDone((b as BlueprintDTO).id) },
      );
    }
  }

  return (
    <>
      <DrawerHeader className="shrink-0 text-left">
        <DrawerTitle>{editing ? '编辑图纸' : '新建图纸'}</DrawerTitle>
        <DrawerDescription>
          图纸是「配方」：抓哪些源、采集还是复查、各项参数——不含节奏（节奏在进程上设）。
        </DrawerDescription>
      </DrawerHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2">
        <div className="space-y-1.5">
          <Label htmlFor="bp-label">名称</Label>
          <Input
            id="bp-label"
            value={label}
            onChange={(ev) => setLabel(ev.target.value)}
            placeholder="请输入图纸名称"
            aria-invalid={e.label}
          />
          {e.label ? <p className="text-sm text-destructive">请填写图纸名称</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bp-note">说明（可选）</Label>
          <Input
            id="bp-note"
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            placeholder="一句话说明"
          />
        </div>

        <div className="space-y-2">
          <Label>类型</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['collect', 'recheck'] as BlueprintKind[]).map((k) => {
              const m = KIND_META[k];
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
                  <m.icon
                    className={cn(
                      'mt-0.5 size-4',
                      active ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.blurb}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>数据源</Label>
            {e.sources ? <span className="text-sm text-destructive">至少选一个源</span> : null}
          </div>
          {SOURCE_KINDS.map((k) => {
            const m = SOURCE_META[k];
            const fm = SOURCE_FORM[k];
            const d = sources[k];
            const cErr = tried && d.enabled && !d.channels.trim();

            return (
              <div key={k} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-sm font-medium">
                    <m.icon className="size-4 text-muted-foreground" />
                    {m.label}
                  </span>
                  <Switch
                    checked={d.enabled}
                    disabled={enabled.length === 1 && d.enabled}
                    onCheckedChange={(v) =>
                      setSources((s) => ({ ...s, [k]: { ...s[k], enabled: v } }))
                    }
                  />
                </div>
                {d.enabled ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fm.channelLabel}
                      </span>
                      <Input
                        value={d.channels}
                        aria-invalid={cErr}
                        onChange={(ev) =>
                          setSources((s) => ({ ...s, [k]: { ...s[k], channels: ev.target.value } }))
                        }
                        placeholder={fm.placeholder}
                      />
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="填入推荐预设"
                        onClick={() =>
                          setSources((s) => ({
                            ...s,
                            [k]: { ...s[k], channels: fm.preset.join(', ') },
                          }))
                        }
                      >
                        <Wand2 className="size-3.5" />
                      </Button>
                    </div>
                    {cErr ? (
                      <p className="text-xs text-destructive">请填写{fm.channelLabel}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label>{kind === 'collect' ? '采集参数' : '复查参数'}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="参数说明"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Info className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="z-[60] w-80 text-sm text-muted-foreground">
                {kind === 'collect'
                  ? '翻页上限：单源单轮最多翻取帖数。连续命中即停：连续 K 条已知帖即停（增量收口）。评论预算：每帖评论抓取上限。'
                  : '每批帖数：一次纳入复查的帖数。批间冷却：批与批之间等待秒数。退避封顶：连续未变跳过的最大轮数。'}
              </PopoverContent>
            </Popover>
          </div>
          {kind === 'collect' ? (
            <div className="grid grid-cols-3 gap-3 rounded-lg border p-3">
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
        <Button variant="outline" onClick={() => onDone()}>
          取消
        </Button>
        <Button onClick={submit} disabled={busy}>
          {editing ? '保存' : '创建图纸'}
        </Button>
      </DrawerFooter>
    </>
  );
}

export function BlueprintFormDialog({
  open,
  onOpenChange,
  editing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: BlueprintDTO;
  onCreated?: (id: number) => void;
}): ReactNode {
  const k = useOpenKey(open);
  const isMobile = useIsMobile();

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={isMobile ? 'bottom' : 'right'}>
      <DrawerContent className="data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col overflow-hidden">
          <BlueprintBody
            key={k}
            editing={editing}
            onDone={(id) => {
              if (id != null) {
                onCreated?.(id);
              }

              onOpenChange(false);
            }}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ─── 进程表单 ──────────────────────────────────────────────────────────────────

function ProcessBody({
  blueprints,
  editing,
  onDone,
}: {
  blueprints: BlueprintDTO[];
  editing?: ProcessDTO;
  onDone: () => void;
}) {
  const create = useCreateProcess();
  const update = useUpdateProcess();
  const [blueprintId, setBlueprintId] = useState<string>(
    String(editing?.blueprintId ?? blueprints[0]?.id ?? ''),
  );
  const blueprint = blueprints.find((b) => String(b.id) === blueprintId);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [tk, setTk] = useState<TriggerKind>(editing?.trigger.kind ?? 'interval');
  const initInterval = splitInterval(
    editing?.trigger.kind === 'interval' ? editing.trigger.everySec : 1800,
  );
  const [intervalValue, setIntervalValue] = useState(initInterval.value);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(initInterval.unit);
  const [cronTime, setCronTime] = useState(
    editing?.trigger.kind === 'cron' ? cronTimeOf(editing.trigger.expr) : '09:00',
  );
  const busy = create.isPending || update.isPending;

  function buildTrigger(): TriggerConfig {
    if (tk === 'once') {
      return { kind: 'once' };
    }

    if (tk === 'cron') {
      return { kind: 'cron', expr: `每天 ${cronTime || '09:00'}` };
    }

    return {
      kind: 'interval',
      everySec: Math.max(5, Math.round(intervalValue) * UNIT_SEC[intervalUnit]),
    };
  }

  function submit(): void {
    if (!blueprint) {
      return;
    }

    const trigger = buildTrigger();
    const finalLabel = label.trim() || `${blueprint.label} · ${triggerSummary(trigger)}`;
    if (editing) {
      update.mutate(
        { id: String(editing.id), label: finalLabel, trigger },
        { onSuccess: () => onDone() },
      );
    } else {
      create.mutate(
        { blueprintId: blueprint.id, label: finalLabel, trigger },
        { onSuccess: () => onDone() },
      );
    }
  }

  return (
    <>
      <DrawerHeader className="shrink-0 text-left">
        <DrawerTitle>{editing ? '编辑进程' : '新建进程'}</DrawerTitle>
        <DrawerDescription>
          {editing
            ? '调整进程名与节奏（所属图纸不变）。'
            : '选一张图纸、设定节奏；同一图纸可建多个不同节奏的进程。'}
        </DrawerDescription>
      </DrawerHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2">
        <div className="space-y-1.5">
          <Label>图纸</Label>
          <Select value={blueprintId} onValueChange={setBlueprintId} disabled={!!editing}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择图纸" />
            </SelectTrigger>
            <SelectContent>
              {blueprints.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {KIND_META[b.kind].label} · {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editing ? (
            <p className="text-xs text-muted-foreground">进程创建后所属图纸不可更改。</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pr-label">进程名（留空自动生成）</Label>
          <Input
            id="pr-label"
            value={label}
            onChange={(ev) => setLabel(ev.target.value)}
            placeholder="请输入进程名称"
          />
        </div>

        <div className="space-y-2">
          <Label>节奏</Label>
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-3">
              {(['once', 'interval', 'cron'] as TriggerKind[]).map((k, i) => {
                const m = TRIGGER_META[k];
                const active = tk === k;

                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTk(k)}
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors',
                      i > 0 && 'border-l',
                      active
                        ? 'bg-primary/5 text-primary'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    <m.icon className="size-4" />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <div className="border-t p-3 text-sm">
              {tk === 'once' ? (
                <p className="text-muted-foreground">单次：创建后等手动「立即触发」。</p>
              ) : tk === 'interval' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">每隔</span>
                    <Input
                      type="number"
                      min={1}
                      value={intervalValue}
                      onChange={(ev) =>
                        setIntervalValue(Math.max(1, Math.round(ev.target.valueAsNumber || 0)))
                      }
                      className="w-20"
                    />
                    <Select
                      value={intervalUnit}
                      onValueChange={(v) => setIntervalUnit(v as IntervalUnit)}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INTERVAL_UNITS.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground">跑一次</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    上一轮跑完冷却后再开下一轮，结构上不堆积；支持秒级（演示用）。
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">每天</span>
                    <Input
                      type="time"
                      value={cronTime}
                      onChange={(ev) => setCronTime(ev.target.value)}
                      className="w-32 dark:[&::-webkit-calendar-picker-indicator]:invert"
                    />
                    <span className="text-muted-foreground">触发</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    墙钟定时触发；适合规律发现新内容。
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DrawerFooter className="shrink-0 flex-row justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button onClick={submit} disabled={!blueprint || busy}>
          {editing ? '保存' : '创建进程'}
        </Button>
      </DrawerFooter>
    </>
  );
}

export function ProcessFormDialog({
  open,
  onOpenChange,
  blueprints,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blueprints: BlueprintDTO[];
  editing?: ProcessDTO;
}): ReactNode {
  const k = useOpenKey(open);
  const isMobile = useIsMobile();

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={isMobile ? 'bottom' : 'right'}>
      <DrawerContent className="data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col overflow-hidden">
          <ProcessBody
            key={k}
            blueprints={blueprints}
            editing={editing}
            onDone={() => onOpenChange(false)}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
