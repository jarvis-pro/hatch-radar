-- 入队幂等的并发兜底：保证同一帖子在 queued/running 期间至多一条活跃任务。
-- 背景：原 enqueueJobs 用「事务内 findMany 预检查 + createMany」去重，但无数据库约束，
-- READ COMMITTED 下两个并发入队（如 cron 的 analyze() 撞上设置页「选用 active」的即时入队）
-- 可能都读到「无活跃任务」而各插一条 → 同帖双任务、被双 worker 认领、双次 AI 调用。

-- 1) 化解历史并发可能已产生的重复活跃任务：同 post_id 的 queued/running 仅保留最早一条
--    （id 最小），其余置为终态 canceled，使下面的唯一索引可顺利建立。
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "post_id" ORDER BY "id") AS rn
  FROM "analysis_jobs"
  WHERE "status" IN ('queued', 'running')
)
UPDATE "analysis_jobs" AS j
SET "status" = 'canceled',
    "finished_at" = floor(extract(epoch FROM now()))::bigint
FROM ranked
WHERE j."id" = ranked."id" AND ranked.rn > 1;

-- 2) 部分唯一索引：仅约束活跃态（queued/running），失败/成功/取消的历史任务可同帖多条
--    （重试跨轮会留多条 failed），故必须用带 WHERE 谓词的部分唯一索引而非整列唯一。
--    注：Prisma schema 无法表达部分索引，本索引仅由迁移管理（schema.prisma 已注明，勿在
--    migrate dev 时被当作 drift 删除）。
CREATE UNIQUE INDEX "uniq_jobs_active_post"
  ON "analysis_jobs" ("post_id")
  WHERE "status" IN ('queued', 'running');
