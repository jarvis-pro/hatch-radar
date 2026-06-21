/**
 * radar 数据层 react-query 键（集中登记，便于失效）。
 * 列表键带筛选对象 → 不同筛选各自缓存；详情键带 id。
 */
import type { RadarInsightFilter, RadarPostFilter } from '@hatch-radar/shared';

export const radarKeys = {
  controlRoom: ['radar', 'control-room'] as const,
  blueprints: ['radar', 'blueprints'] as const,
  processes: ['radar', 'processes'] as const,
  processRuns: (id: number | string) => ['radar', 'process-runs', String(id)] as const,
  run: (id: number | string) => ['radar', 'run', String(id)] as const,
  lanes: ['radar', 'lanes'] as const,
  insights: (f: RadarInsightFilter) => ['radar', 'insights', f] as const,
  posts: (f: RadarPostFilter) => ['radar', 'posts', f] as const,
  post: (id: string) => ['radar', 'post', id] as const,
  insight: (id: string) => ['radar', 'insight', id] as const,
  filters: ['radar', 'filters'] as const,
};
