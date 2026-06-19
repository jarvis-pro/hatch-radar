-- 删除旧 analysis_jobs / job_steps 队列：已被 tasks / task_stages 执行内核取代。
-- 分析（自动 / 手动 / 检视）全部任务化，成本与吞吐看板改自 tasks(kind=analyze) 派生。
-- 先删表（其列引用下面的枚举），再删枚举；部分唯一索引 uniq_jobs_active_post 随表一并删除。
DROP TABLE IF EXISTS "job_steps";
DROP TABLE IF EXISTS "analysis_jobs";

DROP TYPE IF EXISTS "job_status";
DROP TYPE IF EXISTS "job_trigger";
DROP TYPE IF EXISTS "job_kind";
