-- 执行引擎状态机：tasks / runs / blueprints / task_stages / processes 的 kind / status / trigger_kind
-- 由裸 String 收口为 enum。手写迁移：Prisma 自动 diff 对 String→enum 走「drop+recreate」会丢数据，
-- 故改用 ALTER ... USING 原地转换保数据；并保护手工部分唯一索引 uniq_tasks_active_post。

-- 1) 枚举类型
CREATE TYPE "task_kind" AS ENUM ('discover', 'collect', 'recheck', 'analyze', 'translate');
CREATE TYPE "task_status" AS ENUM ('queued', 'running', 'paused', 'succeeded', 'skipped', 'failed', 'canceled');
CREATE TYPE "stage_status" AS ENUM ('pending', 'running', 'done', 'skipped', 'failed');
CREATE TYPE "run_status" AS ENUM ('running', 'paused', 'completed', 'failed', 'canceled');
CREATE TYPE "process_status" AS ENUM ('active', 'paused');
CREATE TYPE "trigger_kind" AS ENUM ('once', 'interval', 'cron');

-- 2) 部分唯一索引谓词依赖 tasks.status / tasks.kind，转型前先删，末尾按 enum 重建。
DROP INDEX IF EXISTS "uniq_tasks_active_post";

-- 3) blueprints.kind（无默认）
ALTER TABLE "blueprints" ALTER COLUMN "kind" TYPE "task_kind" USING ("kind"::"task_kind");

-- 4) processes.trigger_kind（无默认）/ status（默认 active）
ALTER TABLE "processes" ALTER COLUMN "trigger_kind" TYPE "trigger_kind" USING ("trigger_kind"::"trigger_kind");
ALTER TABLE "processes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "processes" ALTER COLUMN "status" TYPE "process_status" USING ("status"::"process_status");
ALTER TABLE "processes" ALTER COLUMN "status" SET DEFAULT 'active';

-- 5) runs.kind（无默认）/ status（默认 running）
ALTER TABLE "runs" ALTER COLUMN "kind" TYPE "task_kind" USING ("kind"::"task_kind");
ALTER TABLE "runs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "runs" ALTER COLUMN "status" TYPE "run_status" USING ("status"::"run_status");
ALTER TABLE "runs" ALTER COLUMN "status" SET DEFAULT 'running';

-- 6) tasks.kind（无默认）/ status（默认 queued）
ALTER TABLE "tasks" ALTER COLUMN "kind" TYPE "task_kind" USING ("kind"::"task_kind");
ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "task_status" USING ("status"::"task_status");
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'queued';

-- 7) task_stages.status（默认 pending）
ALTER TABLE "task_stages" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "task_stages" ALTER COLUMN "status" TYPE "stage_status" USING ("status"::"stage_status");
ALTER TABLE "task_stages" ALTER COLUMN "status" SET DEFAULT 'pending';

-- 8) 重建部分唯一索引（谓词字面量自动按 enum 比较）：同帖同 kind 至多一条活跃任务。
CREATE UNIQUE INDEX "uniq_tasks_active_post" ON "tasks" ("post_id", "kind")
  WHERE "status" IN ('queued', 'running', 'paused') AND "post_id" IS NOT NULL;
