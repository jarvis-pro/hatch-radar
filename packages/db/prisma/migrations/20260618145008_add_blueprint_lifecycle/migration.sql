-- CreateTable
CREATE TABLE "blueprints" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger_kind" TEXT NOT NULL,
    "trigger_config" JSONB,
    "params" JSONB,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "blueprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" SERIAL NOT NULL,
    "blueprint_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger_source" TEXT NOT NULL,
    "sweep_seq" INTEGER,
    "tasks_total" INTEGER NOT NULL DEFAULT 0,
    "tasks_done" INTEGER NOT NULL DEFAULT 0,
    "tasks_skipped" INTEGER NOT NULL DEFAULT 0,
    "tasks_failed" INTEGER NOT NULL DEFAULT 0,
    "params" JSONB,
    "error" TEXT,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "parent_task_id" INTEGER,
    "post_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "current_seq" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "provider_id" INTEGER,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "params" JSONB,
    "error" TEXT,
    "enqueued_at" BIGINT NOT NULL,
    "started_at" BIGINT,
    "finished_at" BIGINT,
    "heartbeat_at" BIGINT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_stages" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gate" BOOLEAN NOT NULL DEFAULT false,
    "input_summary" JSONB,
    "output" JSONB,
    "error" TEXT,
    "started_at" BIGINT,
    "finished_at" BIGINT,

    CONSTRAINT "task_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_queue" (
    "id" SERIAL NOT NULL,
    "lane" TEXT NOT NULL,
    "host" TEXT,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "url" TEXT NOT NULL,
    "params" JSONB,
    "purpose" TEXT NOT NULL,
    "owner_task_id" INTEGER,
    "owner_stage_id" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduled_at" BIGINT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "enqueued_at" BIGINT NOT NULL,
    "started_at" BIGINT,
    "finished_at" BIGINT,

    CONSTRAINT "request_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_lanes" (
    "lane" TEXT NOT NULL,
    "rate_per_minute" INTEGER NOT NULL DEFAULT 90,
    "burst" INTEGER NOT NULL DEFAULT 10,
    "max_concurrency" INTEGER NOT NULL DEFAULT 1,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "request_lanes_pkey" PRIMARY KEY ("lane")
);

-- CreateIndex
CREATE INDEX "idx_blueprints_kind" ON "blueprints"("kind", "enabled");

-- CreateIndex
CREATE INDEX "idx_runs_blueprint" ON "runs"("blueprint_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_runs_status" ON "runs"("status");

-- CreateIndex
CREATE INDEX "idx_tasks_run" ON "tasks"("run_id");

-- CreateIndex
CREATE INDEX "idx_tasks_claim" ON "tasks"("status", "priority", "enqueued_at");

-- CreateIndex
CREATE INDEX "idx_tasks_parent" ON "tasks"("parent_task_id");

-- CreateIndex
CREATE INDEX "idx_tasks_post" ON "tasks"("post_id");

-- CreateIndex
CREATE INDEX "idx_task_stages_task" ON "task_stages"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_task_stages_task_seq" ON "task_stages"("task_id", "seq");

-- CreateIndex
CREATE INDEX "idx_reqq_dispatch" ON "request_queue"("lane", "status", "priority", "scheduled_at");

-- CreateIndex
CREATE INDEX "idx_reqq_owner" ON "request_queue"("owner_task_id");

-- 部分唯一索引（Prisma schema 无法表达，手工维护，勿删）：
-- 同帖同 kind 同时至多一条活跃任务（queued/running/paused），去重第③层（泛化自 uniq_jobs_active_post）。
-- post_id 可空（discover 任务无帖），故谓词含 IS NOT NULL，避免多条 NULL 互斥。
CREATE UNIQUE INDEX "uniq_tasks_active_post" ON "tasks" ("post_id", "kind")
  WHERE "status" IN ('queued', 'running', 'paused') AND "post_id" IS NOT NULL;
