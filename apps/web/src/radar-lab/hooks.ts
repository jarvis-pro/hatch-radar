/**
 * radar 读 hooks（react-query 命中 /api，取代旧 useWorld 本地世界订阅）。
 *
 * 活跃面带 refetchInterval 轮询出「live」感（取代旧模拟时钟）；详情面仅在有进行中任务时轮询。
 * 列表面服务端分页 + keepPreviousData 平滑翻页。组件契约（消费的 DTO 形状）与旧 selector 对齐。
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  BlueprintDTO,
  ControlRoomDTO,
  LaneDTO,
  Paged,
  ProcessDTO,
  RadarFilterOptions,
  RadarInsightDTO,
  RadarInsightDetailDTO,
  RadarInsightFilter,
  RadarPostDTO,
  RadarPostDetailDTO,
  RadarPostFilter,
  RunDTO,
  TaskDTO,
} from '@hatch-radar/shared';
import { api } from '@/api/client';
import { radarKeys } from './query-keys';

/** 把筛选对象拼成 query string（跳过 undefined / 空串）。 */
function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** 指挥室聚合（每 3s 轮询）。 */
export function useControlRoom() {
  return useQuery({
    queryKey: radarKeys.controlRoom,
    queryFn: () => api.get<ControlRoomDTO>('/radar/control-room'),
    refetchInterval: 3000,
  });
}

/** 图纸列表（mutation 失效驱动，不轮询）。 */
export function useBlueprints() {
  return useQuery({
    queryKey: radarKeys.blueprints,
    queryFn: () => api.get<BlueprintDTO[]>('/blueprints'),
  });
}

/** 进程列表（轻量 5s 轮询，反映 runsTotal / nextRunAt 变化）。 */
export function useProcesses() {
  return useQuery({
    queryKey: radarKeys.processes,
    queryFn: () => api.get<ProcessDTO[]>('/processes'),
    refetchInterval: 5000,
  });
}

/** 某进程的运行历史（有进行中运行时 2s 轮询）。 */
export function useProcessRuns(processId: string) {
  return useQuery({
    queryKey: radarKeys.processRuns(processId),
    queryFn: () =>
      api.get<{ process: ProcessDTO | null; runs: RunDTO[] }>(`/processes/${processId}/runs`),
    refetchInterval: (q) =>
      (q.state.data?.runs ?? []).some((r) => r.status === 'running') ? 2000 : false,
  });
}

/** 运行详情：运行 + 任务树（有进行中任务时 1.5s 轮询）。 */
export function useRun(runId: string) {
  return useQuery({
    queryKey: radarKeys.run(runId),
    queryFn: () => api.get<{ run: RunDTO; tasks: TaskDTO[] }>(`/radar/runs/${runId}`),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) {
        return false;
      }
      const active =
        d.run.status === 'running' ||
        d.tasks.some(
          (t) => t.status === 'queued' || t.status === 'running' || t.status === 'paused',
        );
      return active ? 1500 : false;
    },
  });
}

/** 请求闸 lane 概览（每 2s 轮询）。 */
export function useLanes() {
  return useQuery({
    queryKey: radarKeys.lanes,
    queryFn: () => api.get<LaneDTO[]>('/radar/lanes'),
    refetchInterval: 2000,
  });
}

/** 收成洞察（服务端分页 / 筛选 / 排序；翻页保留上页数据）。 */
export function useInsights(filter: RadarInsightFilter) {
  return useQuery({
    queryKey: radarKeys.insights(filter),
    queryFn: () => api.get<Paged<RadarInsightDTO>>(`/radar/insights${qs({ ...filter })}`),
    placeholderData: keepPreviousData,
  });
}

/** 单条洞察详情（痛点 / 机会 / 研判全展开）。 */
export function useInsightDetail(id: string) {
  return useQuery({
    queryKey: radarKeys.insight(id),
    queryFn: () => api.get<RadarInsightDetailDTO>(`/radar/insights/${id}`),
  });
}

/** 来源 / 版块去重清单（洞察库筛选下拉 + 导出批次；变动慢，缓存 5 分钟）。 */
export function useRadarFilterOptions() {
  return useQuery({
    queryKey: radarKeys.filters,
    queryFn: () => api.get<RadarFilterOptions>('/radar/insights/filters'),
    staleTime: 5 * 60_000,
  });
}

/** 帖子库（服务端分页 / 筛选）。 */
export function usePostLibrary(filter: RadarPostFilter) {
  return useQuery({
    queryKey: radarKeys.posts(filter),
    queryFn: () => api.get<Paged<RadarPostDTO>>(`/radar/posts${qs({ ...filter })}`),
    placeholderData: keepPreviousData,
  });
}

/** 帖子一生详情（帖 + 评论树 + 跨运行事件 + 洞察）。 */
export function usePostDetail(id: string) {
  return useQuery({
    queryKey: radarKeys.post(id),
    queryFn: () => api.get<RadarPostDetailDTO>(`/radar/posts/${id}`),
  });
}
