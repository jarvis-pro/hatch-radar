-- ─────────────────────────────────────────────────────────────────────────
-- 把「同帖至多一条活跃分析任务」的部分唯一索引扩到含 paused。
-- 流水线检视器引入 paused（节点间闸门态）：暂停中的检视任务仍占着该帖的「活跃」名额——
-- 既不该被另起一条检视/自动分析任务争用，paused→queued 放行时也不得与并行入队的普通任务撞车。
-- 故把 paused 纳入索引谓词，与 claimNextJob/reclaim「不认领/不回收 paused」相互独立、各司其职。
-- 存量数据无 paused 行，重建安全。
-- ─────────────────────────────────────────────────────────────────────────
DROP INDEX "uniq_jobs_active_post";
CREATE UNIQUE INDEX "uniq_jobs_active_post"
  ON "analysis_jobs" ("post_id", "job_type")
  WHERE "status" IN ('queued', 'running', 'paused');
