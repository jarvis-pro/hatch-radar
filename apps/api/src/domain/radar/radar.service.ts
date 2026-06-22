import { Injectable } from '@nestjs/common';
import {
  BlueprintsRepository,
  CommentsRepository,
  InsightsRepository,
  PostsRepository,
  RequestLanesRepository,
  RequestQueueRepository,
  RunsRepository,
  TaskStagesRepository,
  TasksRepository,
  TranslationsRepository,
  type RunRow,
  type TaskRow,
  type TaskStageRow,
} from '@/lib/db';
import { nowSec } from '@/lib/kernel';
import {
  PAGE_SIZE,
  type ControlRoomDTO,
  type LaneDTO,
  type Paged,
  type PostLifecycleEvent,
  type RadarFilterOptions,
  type RadarInsightDTO,
  type RadarInsightDetailDTO,
  type RadarInsightFilter,
  type RadarIntensity,
  type RadarPostDTO,
  type RadarPostDetailDTO,
  type RadarPostFilter,
  type RadarTaskStatus,
  type RequestRowDTO,
  type RunDTO,
  type TaskDTO,
  type TaskKind,
} from '@hatch-radar/shared';
import { ProcessService } from './process.service';
import {
  asRecord,
  asStrArr,
  buildCommentTree,
  firstPainPoint,
  toRunDTO,
  toStageDTO,
} from './radar.mappers';

const ALERTS_LIMIT = 5;
const RECENT_PER_LANE = 8;

/**
 * 雷达指挥室只读 / 聚合服务（控制面）。
 *
 * 关注点 = 读：control-room 聚合、运行详情、收成洞察 / 帖子库分页、帖子一生、lane 概览（合成 web 视图 DTO）。
 * 图纸 CRUD 见 {@link BlueprintService}，进程 CRUD / 触发见 {@link ProcessService}（本服务聚合时复用其列举）。
 * 译文标题（titleZh）按 posts.title_hash 从 translations(done) 批量 join。
 */
@Injectable()
export class RadarService {
  constructor(
    private readonly blueprints: BlueprintsRepository,
    private readonly processSvc: ProcessService,
    private readonly runs: RunsRepository,
    private readonly tasks: TasksRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly requestQueue: RequestQueueRepository,
    private readonly requestLanes: RequestLanesRepository,
    private readonly posts: PostsRepository,
    private readonly insights: InsightsRepository,
    private readonly comments: CommentsRepository,
    private readonly translations: TranslationsRepository,
  ) {}

  // ─── 运行详情 ──────────────────────────────────────────────────────────────────

  /** 运行详情：运行 + 任务树（每任务含环节，lane / 产物摘要已合成）。 */
  async runDetail(id: number): Promise<{ run: RunDTO; tasks: TaskDTO[] } | null> {
    const run = await this.runs.getRun(id);
    if (!run) return null;
    const [bp, proc, tasks] = await Promise.all([
      this.blueprints.getBlueprint(run.blueprint_id),
      run.process_id != null ? this.processSvc.getProcess(run.process_id) : Promise.resolve(null),
      this.tasks.listByRun(id),
    ]);
    const postIds = [...new Set(tasks.map((t) => t.post_id).filter((x): x is string => x != null))];
    const posts = await this.posts.listSummaryByIds(postIds);
    const postById = new Map(posts.map((p) => [p.id, p]));
    const stagesByTask = await this.taskStages.listStagesByTasks(tasks.map((t) => t.id));
    const taskViews: TaskDTO[] = tasks.map((t) => {
      const post = t.post_id != null ? postById.get(t.post_id) : undefined;
      return this.toTaskDTO(t, stagesByTask.get(t.id) ?? [], post?.source ?? null, post?.title ?? null);
    });
    return {
      run: toRunDTO(run, bp?.label ?? null, proc?.label ?? null),
      tasks: taskViews,
    };
  }

  private toTaskDTO(
    t: TaskRow,
    stages: TaskStageRow[],
    source: string | null,
    postTitle: string | null,
  ): TaskDTO {
    const kind = t.kind as TaskKind;
    return {
      id: t.id,
      runId: t.run_id,
      kind,
      status: t.status as RadarTaskStatus,
      parentTaskId: t.parent_task_id,
      postId: t.post_id,
      postTitle,
      model: t.model,
      attempts: t.attempts,
      error: t.error,
      enqueuedAt: t.enqueued_at,
      startedAt: t.started_at,
      finishedAt: t.finished_at,
      stages: stages.map((s) => toStageDTO(s, kind, source)),
    };
  }

  // ─── lane 概览 ────────────────────────────────────────────────────────────────

  async lanes(): Promise<LaneDTO[]> {
    const now = nowSec();
    const [lanes, recent, counts] = await Promise.all([
      this.requestLanes.listLanes(),
      this.requestQueue.listRecent(120),
      this.requestQueue.laneCounts(now - 60), // 近 60s 完成数 ≈ 每分钟速率
    ]);
    const countByLane = new Map(counts.map((c) => [c.lane, c]));
    const recentByLane = new Map<string, RequestRowDTO[]>();
    for (const r of recent) {
      const list = recentByLane.get(r.lane) ?? [];
      if (list.length < RECENT_PER_LANE) {
        list.push({
          id: r.id,
          lane: r.lane,
          purpose: r.purpose,
          ownerTaskId: r.owner_task_id,
          status: r.status,
          detail: r.url,
          enqueuedAt: r.enqueued_at,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
        });
        recentByLane.set(r.lane, list);
      }
    }
    return lanes.map((l) => {
      const c = countByLane.get(l.lane);
      const depth = c?.running ?? 0;
      const rate = c?.recent ?? 0;
      return {
        id: l.lane,
        label: l.lane,
        ratePerMin: l.rate_per_minute,
        paused: l.paused,
        rate,
        depth,
        etaSec: rate > 0 && depth > 0 ? Math.round((depth / rate) * 60) : null,
        recent: recentByLane.get(l.lane) ?? [],
      };
    });
  }

  // ─── 指挥室聚合 ────────────────────────────────────────────────────────────────

  async controlRoom(): Promise<ControlRoomDTO> {
    const now = nowSec();
    const dayStart = now - (now % 86400);
    const [insightsToday, postsToday, runsToday, taskStats, lanes, procDtos, runningRuns, recheck] =
      await Promise.all([
        this.insights.countSince(dayStart),
        this.posts.countFetchedSince(dayStart),
        this.runs.countSince(dayStart),
        this.tasks.taskStats(),
        this.lanes(),
        this.processSvc.listProcesses(),
        this.runs.listRunningRuns(), // 进行中运行（用于 activeRun）
        this.recheckHealth(now),
      ]);

    // 每进程的进行中运行（复用 listRunningRuns 结果，已是 RunRow）
    const runningByProcess = new Map<number, RunRow>();
    for (const r of runningRuns) {
      if (r.process_id != null) runningByProcess.set(r.process_id, r);
    }
    const processes = procDtos.map((p) => {
      const run = runningByProcess.get(p.id);
      return {
        ...p,
        activeRun: run
          ? {
              id: run.id,
              tasksTotal: run.tasks_total,
              tasksDone: run.tasks_done,
              tasksFailed: run.tasks_failed,
            }
          : null,
      };
    });

    const failedRuns = await this.runs.listFailedRuns(ALERTS_LIMIT);
    const bps = await this.blueprints.listBlueprints();
    const bpLabel = new Map(bps.map((b) => [b.id, b.label]));

    return {
      today: {
        insights: insightsToday,
        posts: postsToday,
        runs: runsToday,
        inflight: taskStats.queued + taskStats.running + taskStats.paused,
        // 单进程归一：执行器内嵌本进程，进程在则恒 1 个「worker」在线（顶栏系统脉搏据此显示在线）。
        workers: 1,
      },
      lanes,
      processes,
      alerts: failedRuns.map((r) => toRunDTO(r, bpLabel.get(r.blueprint_id) ?? null, null)),
      recheck,
    };
  }

  private async recheckHealth(now: number): Promise<ControlRoomDTO['recheck']> {
    void now;
    const sweep = await this.runs.maxRecheckSweep();
    const [dueNow, dist] = await Promise.all([
      this.posts.countRecheckDue(sweep),
      this.posts.recheckMissesDistribution(),
    ]);
    return { sweep, dueNow, dist };
  }

  // ─── 收成洞察（分页） ───────────────────────────────────────────────────────────

  async listInsights(f: RadarInsightFilter): Promise<Paged<RadarInsightDTO>> {
    const size = f.size && f.size > 0 ? f.size : PAGE_SIZE;
    const total = await this.insights.countForRadar(f);
    const pageCount = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(1, f.page ?? 1), pageCount);
    const rows = await this.insights.listForRadar(f, (page - 1) * size, size);
    const titleZhByPost = await this.titleZhForPosts(rows.map((r) => r.post_id));
    const items: RadarInsightDTO[] = rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      source: r.source,
      channel: r.subreddit,
      postTitle: r.post_title,
      titleZh: titleZhByPost.get(r.post_id) ?? null,
      intensity: (r.intensity as string).toLowerCase() as RadarInsightDTO['intensity'],
      painPoint: firstPainPoint(r.pain_points, r.post_title),
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      oppCount: Array.isArray(r.opportunities) ? (r.opportunities as unknown[]).length : 0,
      createdAt: Number(r.created_at),
    }));
    return { items, total, page, pageCount };
  }

  /** 单条洞察详情（痛点 / 机会 / 人工研判全展开 + 译文标题 + 源帖是否仍在库）。 */
  async insightDetail(id: number): Promise<RadarInsightDetailDTO | null> {
    const r = await this.insights.getRawById(id);
    if (!r) return null;
    const [triageRow, postExists, titleZhByPost] = await Promise.all([
      this.insights.getTriageByInsightId(id),
      this.posts.exists(r.post_id),
      this.titleZhForPosts([r.post_id]),
    ]);
    const toIntensity = (v: unknown): RadarIntensity => {
      const s = String(v).toLowerCase();
      return s === 'high' || s === 'medium' ? s : 'low';
    };
    const painPoints = (Array.isArray(r.pain_points) ? r.pain_points : []).map((p) => {
      const o = asRecord(p);
      return {
        description: typeof o.description === 'string' ? o.description : '',
        evidence: typeof o.evidence === 'string' ? o.evidence : '',
        intensity: toIntensity(o.intensity),
      };
    });
    const opportunities = (Array.isArray(r.opportunities) ? r.opportunities : []).map((p) => {
      const o = asRecord(p);
      return {
        title: typeof o.title === 'string' ? o.title : '',
        description: typeof o.description === 'string' ? o.description : '',
        targetUser: typeof o.target_user === 'string' ? o.target_user : '',
      };
    });
    return {
      id: r.id,
      postId: r.post_id,
      source: r.source,
      channel: r.subreddit,
      postTitle: r.post_title,
      titleZh: titleZhByPost.get(r.post_id) ?? null,
      permalink: r.permalink,
      model: r.model,
      intensity: toIntensity(r.intensity),
      painPoints,
      opportunities,
      tags: asStrArr(r.tags),
      triage: triageRow
        ? {
            status: triageRow.status,
            rating: triageRow.rating,
            tags: asStrArr(triageRow.tags),
            note: triageRow.note,
            updatedAt: Number(triageRow.updated_at),
          }
        : null,
      postExists,
      createdAt: Number(r.created_at),
    };
  }

  /** 来源 / 版块去重清单（洞察口径，供洞察库筛选下拉 + 导出批次按钮）。 */
  async filterOptions(): Promise<RadarFilterOptions> {
    const [sources, subreddits] = await Promise.all([
      this.insights.distinctSources(),
      this.insights.distinctSubreddits(),
    ]);
    return { sources, subreddits };
  }

  // ─── 帖子库（分页） ─────────────────────────────────────────────────────────────

  async listPosts(f: RadarPostFilter): Promise<Paged<RadarPostDTO>> {
    const size = f.size && f.size > 0 ? f.size : PAGE_SIZE;
    const sweep = await this.runs.maxRecheckSweep();
    const total = await this.posts.countForRadar(f, sweep);
    const pageCount = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(1, f.page ?? 1), pageCount);
    const rows = await this.posts.listForRadar(f, sweep, (page - 1) * size, size);
    const zhByHash = await this.translationsByHash(
      rows.flatMap((r) => [r.title_hash, r.selftext_hash].filter((x): x is string => x != null)),
    );
    const items: RadarPostDTO[] = rows.map((p) => ({
      id: p.id,
      source: p.source,
      channel: p.subreddit,
      title: p.title,
      titleZh: p.title_hash ? (zhByHash.get(p.title_hash) ?? null) : null,
      body: p.selftext,
      bodyZh: p.selftext_hash ? (zhByHash.get(p.selftext_hash) ?? null) : null,
      titleHash: p.title_hash,
      selftextHash: p.selftext_hash,
      author: p.author,
      score: p.score,
      numComments: p.num_comments,
      createdUtc: Number(p.created_utc),
      recheckMisses: p.recheck_misses,
      recheckDueSweep: p.recheck_due_sweep,
      lastRecheckedAt: p.last_rechecked_at == null ? null : Number(p.last_rechecked_at),
      analyzed: p.analyzed_at != null,
    }));
    return { items, total, page, pageCount };
  }

  // ─── 帖子一生（详情） ──────────────────────────────────────────────────────────

  async postDetail(id: string): Promise<RadarPostDetailDTO | null> {
    const p = await this.posts.getRawById(id);
    if (!p) return null;
    const [commentRows, taskRows, insightRow, zhByHash] = await Promise.all([
      this.comments.listRawForPost(id),
      this.tasks.listByPost(id),
      this.insights.getRawByPostId(id),
      this.translationsByHash(
        [p.title_hash, p.selftext_hash].filter((x): x is string => x != null),
      ),
    ]);
    // 跨运行一生时间线
    const runIds = [...new Set(taskRows.map((t) => t.run_id))];
    const sweepByRun = await this.runs.sweepSeqByRunIds(runIds);
    const events: PostLifecycleEvent[] = taskRows.map((t) => ({
      taskId: t.id,
      runId: t.run_id,
      kind: t.kind as TaskKind,
      status: t.status as RadarTaskStatus,
      sweepSeq: sweepByRun.get(t.run_id) ?? null,
      at: Number(t.finished_at ?? t.enqueued_at),
    }));
    const post: RadarPostDTO = {
      id: p.id,
      source: p.source,
      channel: p.subreddit,
      title: p.title,
      titleZh: p.title_hash ? (zhByHash.get(p.title_hash) ?? null) : null,
      body: p.selftext,
      bodyZh: p.selftext_hash ? (zhByHash.get(p.selftext_hash) ?? null) : null,
      titleHash: p.title_hash,
      selftextHash: p.selftext_hash,
      author: p.author,
      score: p.score,
      numComments: p.num_comments,
      createdUtc: Number(p.created_utc),
      recheckMisses: p.recheck_misses,
      recheckDueSweep: p.recheck_due_sweep,
      lastRecheckedAt: p.last_rechecked_at == null ? null : Number(p.last_rechecked_at),
      analyzed: p.analyzed_at != null,
    };
    const insights: RadarInsightDTO[] = insightRow
      ? [
          {
            id: insightRow.id,
            postId: insightRow.post_id,
            source: insightRow.source,
            channel: insightRow.subreddit,
            postTitle: insightRow.post_title,
            titleZh: post.titleZh,
            intensity: (
              insightRow.intensity as string
            ).toLowerCase() as RadarInsightDTO['intensity'],
            painPoint: firstPainPoint(insightRow.pain_points, insightRow.post_title),
            tags: Array.isArray(insightRow.tags) ? (insightRow.tags as string[]) : [],
            oppCount: Array.isArray(insightRow.opportunities)
              ? (insightRow.opportunities as unknown[]).length
              : 0,
            createdAt: Number(insightRow.created_at),
          },
        ]
      : [];
    return { post, comments: buildCommentTree(commentRows), events, insights };
  }

  // ─── 译文 join 辅助 ────────────────────────────────────────────────────────────

  /** content_hash → 中文译文（status=done）。 */
  private async translationsByHash(hashes: string[]): Promise<Map<string, string>> {
    return this.translations.doneTextByHashes(hashes);
  }

  /** 帖子 id → 标题译文（经 posts.title_hash join translations）。 */
  private async titleZhForPosts(postIds: string[]): Promise<Map<string, string>> {
    const hashByPost = await this.posts.titleHashByIds(postIds);
    const zhByHash = await this.translationsByHash(
      [...hashByPost.values()].filter((x): x is string => x != null),
    );
    const out = new Map<string, string>();
    for (const [postId, hash] of hashByPost) {
      const zh = hash ? zhByHash.get(hash) : undefined;
      if (zh) out.set(postId, zh);
    }
    return out;
  }
}
