/**
 * radar 写 hooks（react-query mutation + sonner toast + 失效相关查询）。
 * 取代旧 store commands；CSRF 头由 api 客户端自动带。runId 入参用于精准失效该运行详情。
 */
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from '@hatch-radar/ui/components/sonner';
import type { BlueprintKind, BlueprintSource, TriggerConfig } from '@hatch-radar/shared';
import { api, ApiError } from '@/api/client';
import { radarKeys } from './query-keys';

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : '操作失败';
}

/** 失效一组查询键（list 类传前缀即可命中全部筛选变体）。 */
function useInvalidate(): (keys: QueryKey[]) => void {
  const qc = useQueryClient();

  return (keys) => {
    for (const key of keys) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

// ─── 进程 ────────────────────────────────────────────────────────────────────

export function useTriggerProcess() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (processId: string) => api.post(`/processes/${processId}/trigger`),
    onSuccess: () => {
      toast.success('已触发');
      invalidate([radarKeys.controlRoom, radarKeys.processes]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useSetProcessStatus() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' }) =>
      api.post(`/processes/${id}/${status === 'active' ? 'resume' : 'pause'}`),
    onSuccess: (_d, v) => {
      toast.success(v.status === 'active' ? '已恢复' : '已暂停');
      invalidate([radarKeys.controlRoom, radarKeys.processes]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useCreateProcess() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (body: { blueprintId: number; label: string; trigger: TriggerConfig }) =>
      api.post('/processes', body),
    onSuccess: () => {
      toast.success('进程已创建');
      invalidate([radarKeys.controlRoom, radarKeys.processes, radarKeys.blueprints]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useUpdateProcess() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; label?: string; trigger?: TriggerConfig }) =>
      api.patch(`/processes/${id}`, patch),
    onSuccess: () => {
      toast.success('进程已更新');
      invalidate([radarKeys.controlRoom, radarKeys.processes]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useDeleteProcess() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (id: string) => api.del(`/processes/${id}`),
    onSuccess: () => {
      toast.success('进程已删除');
      invalidate([radarKeys.controlRoom, radarKeys.processes, radarKeys.blueprints]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

// ─── 请求闸 lane ──────────────────────────────────────────────────────────────

export function usePauseLane() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ lane, paused }: { lane: string; paused: boolean }) =>
      api.post(`/requests/lanes/${lane}/${paused ? 'pause' : 'resume'}`),
    onSuccess: () => invalidate([radarKeys.lanes, radarKeys.controlRoom]),
    onError: (e) => toast.error(errMsg(e)),
  });
}

// ─── 运行 / 任务控制（逐环节）──────────────────────────────────────────────────

/** 放行下一步 / 运行到底 / 重试 / 取消：共用「对 taskId 操作 + 失效该运行」工厂。 */
function useTaskAction(runId: string, action: string, okMsg: string, extra: QueryKey[] = []) {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (taskId: number) => api.post(`/pipeline/tasks/${taskId}/${action}`),
    onSuccess: () => {
      toast.success(okMsg);
      invalidate([radarKeys.run(runId), ...extra]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useReleaseStage(runId: string) {
  return useTaskAction(runId, 'resume', '已放行');
}

export function useRunToEnd(runId: string) {
  return useTaskAction(runId, 'run-to-end', '已设为运行到底');
}

export function useRetryStage(runId: string) {
  return useTaskAction(runId, 'retry', '已重试');
}

export function useCancelTask(runId: string) {
  return useTaskAction(runId, 'cancel', '已取消', [radarKeys.controlRoom]);
}

/** 运行前挂 / 摘某环节暂停点。 */
export function useToggleStageGate(runId: string) {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ taskId, seq, gate }: { taskId: number; seq: number; gate: boolean }) =>
      api.post(`/pipeline/tasks/${taskId}/stages/${seq}/gate`, { gate }),
    onSuccess: () => invalidate([radarKeys.run(runId)]),
    onError: (e) => toast.error(errMsg(e)),
  });
}

// ─── 图纸 ────────────────────────────────────────────────────────────────────

export interface BlueprintBody {
  kind?: BlueprintKind;
  label?: string;
  note?: string | null;
  sources?: BlueprintSource[];
  params?: Record<string, unknown>;
  gates?: string[];
  enabledStages?: string[];
}

export function useCreateBlueprint() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (body: BlueprintBody & { kind: BlueprintKind; label: string }) =>
      api.post('/blueprints', body),
    onSuccess: () => {
      toast.success('图纸已创建');
      invalidate([radarKeys.blueprints, radarKeys.controlRoom]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useUpdateBlueprint() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ id, ...patch }: BlueprintBody & { id: number }) =>
      api.patch(`/blueprints/${id}`, patch),
    onSuccess: () => invalidate([radarKeys.blueprints, radarKeys.controlRoom]),
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useDeleteBlueprint() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (id: number) => api.del(`/blueprints/${id}`),
    onSuccess: () => {
      toast.success('图纸已删除');
      invalidate([radarKeys.blueprints, radarKeys.processes]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}
