/**
 * 雷达指挥室（radar-lab）—— store：useSyncExternalStore + 模拟时钟 + commands。
 *
 * 世界是本地、同步、高频的，故**不走 react-query**：组件经 {@link useWorld} 订阅世界版本、
 * 每帧重渲染并即时取最新切片；操作经 commands 改 world 并通知，跨页即时可见。
 * 后端落地时，这一层 read 换成 react-query + WS（实时通道），组件契约不变。
 */
import { useSyncExternalStore } from 'react';
import { type Speed, TICK_MS } from './constants';
import { startRun, tick } from './engine';
import type { ProcessStatus, World } from './types';
import { createInitialWorld } from './world';

let world = createInitialWorld();
let speed: Speed = 4;
let paused = false;
let version = 0;

const listeners = new Set<() => void>();
function emit(): void {
  version += 1;
  for (const l of listeners) l();
}
function getVersion(): number {
  return version;
}

let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      if (paused) return;
      tick(world, TICK_MS * speed);
      emit();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** 读：订阅世界版本，每次变更重渲染；selector 即时取最新世界切片。 */
export function useWorld<T>(selector: (w: World) => T): T {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return selector(world);
}

/** 时钟状态（倍速 / 暂停 / sim 时刻）。 */
export function useClock(): { nowMs: number; speed: Speed; paused: boolean } {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return { nowMs: world.nowMs, speed, paused };
}

// ─── 时钟控制 ──────────────────────────────────────────────────────────────────

export function setSpeed(s: Speed): void {
  speed = s;
  emit();
}
export function togglePaused(): void {
  paused = !paused;
  emit();
}
/** 单步：不论是否暂停都推进一帧。 */
export function stepOnce(): void {
  tick(world, TICK_MS * speed);
  emit();
}
export function resetWorld(): void {
  world = createInitialWorld();
  emit();
}

// ─── commands（改 world + 通知；跨页即时可见） ─────────────────────────────────

export function triggerProcess(processId: string): void {
  const running = world.runs.some((r) => r.processId === processId && r.status === 'running');
  if (!running) startRun(world, processId, 'manual');
  emit();
}

export function setProcessStatus(processId: string, status: ProcessStatus): void {
  const p = world.processes.find((x) => x.id === processId);
  if (!p) return;
  p.status = status;
  p.nextRunAt =
    status === 'active' ? (p.trigger.kind === 'once' ? null : world.nowMs + 5000) : null;
  emit();
}

export function pauseLane(laneId: string, isPaused: boolean): void {
  const l = world.lanes.find((x) => x.id === laneId);
  if (l) l.paused = isPaused;
  emit();
}

/**
 * 放行下一步：清掉暂停任务当前挂闸环节的闸门，并把闸门「往后挪一格」（即下一 pending 环节）——
 * 于是任务恰好跑完这一环节又停在下一环节，呈现逐环节单步。无下一环节则跑到底。
 */
export function releaseStage(taskId: string): void {
  const t = world.tasks.find((x) => x.id === taskId);
  if (!t || t.status !== 'paused') return;
  const gated = t.stages.find((s) => s.status === 'pending' && s.gate);
  if (gated) {
    gated.gate = false;
    const next = t.stages.find((s) => s.seq > gated.seq && s.status === 'pending');
    if (next) next.gate = true;
  }
  t.status = 'running';
  emit();
}

/** 运行到底：清掉该任务后续所有闸门，恢复运行直至终态。 */
export function runToEnd(taskId: string): void {
  const t = world.tasks.find((x) => x.id === taskId);
  if (!t) return;
  for (const s of t.stages) if (s.status === 'pending') s.gate = false;
  if (t.status === 'paused') t.status = 'running';
  emit();
}

/** 重试本环节：失败任务的失败环节复位待执行，任务回运行。 */
export function retryStage(taskId: string): void {
  const t = world.tasks.find((x) => x.id === taskId);
  if (!t || t.status !== 'failed') return;
  const failed = t.stages.find((s) => s.status === 'failed');
  if (failed) {
    failed.status = 'pending';
    failed.error = null;
    failed.elapsedMs = 0;
  }
  t.status = 'running';
  t.finishedAt = null;
  emit();
}

export function cancelTask(taskId: string): void {
  const t = world.tasks.find((x) => x.id === taskId);
  if (!t) return;
  t.status = 'canceled';
  t.finishedAt = world.nowMs;
  emit();
}

/** 临时挂 / 摘某 pending 环节的闸门（运行前可调）。 */
export function toggleGate(taskId: string, seq: number): void {
  const t = world.tasks.find((x) => x.id === taskId);
  const s = t?.stages.find((x) => x.seq === seq);
  if (s && s.status === 'pending') {
    s.gate = !s.gate;
    emit();
  }
}
