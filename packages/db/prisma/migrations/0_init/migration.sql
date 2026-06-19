-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('super_admin', 'admin');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('pending', 'consumed', 'revoked');

-- CreateEnum
CREATE TYPE "intensity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "translation_field" AS ENUM ('post_title', 'post_selftext', 'comment_body');

-- CreateEnum
CREATE TYPE "translation_status" AS ENUM ('pending', 'translating', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "provider_kind" AS ENUM ('anthropic', 'openai', 'deepseek', 'claude_cli', 'azure');

-- CreateEnum
CREATE TYPE "api_key_status" AS ENUM ('active', 'cooling', 'invalid');

-- CreateEnum
CREATE TYPE "source_platform" AS ENUM ('reddit', 'hackernews', 'rss');

-- CreateEnum
CREATE TYPE "connector_auth" AS ENUM ('oauth', 'scrape');

-- CreateEnum
CREATE TYPE "triage_status" AS ENUM ('pending', 'shortlisted', 'archived');

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

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "author" TEXT,
    "body" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "created_utc" BIGINT NOT NULL,
    "fetched_at" BIGINT NOT NULL,
    "body_hash" TEXT,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" SERIAL NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source_field" "translation_field" NOT NULL,
    "source_lang" TEXT,
    "text" TEXT,
    "provider_kind" "provider_kind",
    "provider_id" INTEGER,
    "status" "translation_status" NOT NULL DEFAULT 'pending',
    "char_count" INTEGER,
    "last_error" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" SERIAL NOT NULL,
    "post_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'reddit',
    "subreddit" TEXT NOT NULL,
    "post_title" TEXT NOT NULL,
    "permalink" TEXT,
    "model" TEXT NOT NULL,
    "intensity" "intensity" NOT NULL,
    "pain_points" JSONB NOT NULL,
    "opportunities" JSONB NOT NULL,
    "tags" JSONB NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_providers" (
    "id" SERIAL NOT NULL,
    "provider" "provider_kind" NOT NULL,
    "label" TEXT NOT NULL,
    "base_url" TEXT,
    "region" TEXT,
    "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "input_price" DOUBLE PRECISION,
    "output_price" DOUBLE PRECISION,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_api_keys" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "api_key" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "api_key_status" NOT NULL DEFAULT 'active',
    "cooldown_until" BIGINT,
    "last_error" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "provider_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" SERIAL NOT NULL,
    "platform" "source_platform" NOT NULL,
    "identifier" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_connectors" (
    "id" SERIAL NOT NULL,
    "platform" "source_platform" NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "auth_kind" "connector_auth" NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "last_check_ok" BOOLEAN,
    "last_check_at" BIGINT,
    "last_check_error" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "source_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'reddit',
    "subreddit" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "selftext" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "permalink" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "num_comments" INTEGER NOT NULL DEFAULT 0,
    "created_utc" BIGINT NOT NULL,
    "fetched_at" BIGINT NOT NULL,
    "comment_pass" INTEGER NOT NULL DEFAULT 0,
    "comments_fetched_at" BIGINT,
    "comments_changed_at" BIGINT,
    "export_locked_at" BIGINT,
    "analyzed_at" BIGINT,
    "analyze_attempts" INTEGER NOT NULL DEFAULT 0,
    "title_hash" TEXT,
    "selftext_hash" TEXT,
    "recheck_misses" INTEGER NOT NULL DEFAULT 0,
    "recheck_due_sweep" INTEGER NOT NULL DEFAULT 0,
    "last_rechecked_at" BIGINT,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_ops" (
    "op_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target_id" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" BIGINT NOT NULL,
    "applied_at" BIGINT NOT NULL,

    CONSTRAINT "sync_ops_pkey" PRIMARY KEY ("op_id")
);

-- CreateTable
CREATE TABLE "triage" (
    "insight_id" INTEGER NOT NULL,
    "status" "triage_status" NOT NULL DEFAULT 'pending',
    "rating" INTEGER,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "triage_pkey" PRIMARY KEY ("insight_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'admin',
    "status" "user_status" NOT NULL DEFAULT 'active',
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" BIGINT,
    "created_by" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "granted_by" TEXT,
    "granted_at" BIGINT NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "last_seen_at" BIGINT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "status" "device_status" NOT NULL DEFAULT 'active',
    "ttl_days" INTEGER NOT NULL DEFAULT 30,
    "expires_at" BIGINT NOT NULL,
    "last_seen_at" BIGINT,
    "issued_by" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "device_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_enrollments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "ttl_days" INTEGER NOT NULL DEFAULT 30,
    "status" "enrollment_status" NOT NULL DEFAULT 'pending',
    "expires_at" BIGINT NOT NULL,
    "issued_by" TEXT,
    "created_at" BIGINT NOT NULL,
    "consumed_at" BIGINT,

    CONSTRAINT "device_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "email" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" BIGINT,
    "last_attempt_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("email")
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

-- CreateIndex
CREATE INDEX "idx_comments_post" ON "comments"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_translations_hash" ON "translations"("content_hash");

-- CreateIndex
CREATE INDEX "idx_translations_status" ON "translations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "idx_insights_post" ON "insights"("post_id");

-- CreateIndex
CREATE INDEX "idx_insights_intensity" ON "insights"("intensity");

-- CreateIndex
CREATE INDEX "idx_insights_subreddit" ON "insights"("subreddit");

-- CreateIndex
CREATE INDEX "idx_provider_keys_provider" ON "provider_api_keys"("provider_id");

-- CreateIndex
CREATE INDEX "idx_sources_enabled" ON "sources"("platform", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_sources_platform_ident" ON "sources"("platform", "identifier");

-- CreateIndex
CREATE INDEX "idx_connectors_platform" ON "source_connectors"("platform");

-- CreateIndex
CREATE INDEX "idx_posts_created" ON "posts"("created_utc");

-- CreateIndex
CREATE INDEX "idx_posts_pending" ON "posts"("analyzed_at", "comment_pass");

-- CreateIndex
CREATE INDEX "idx_posts_subreddit" ON "posts"("subreddit");

-- CreateIndex
CREATE UNIQUE INDEX "idx_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_perm_user" ON "user_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_sessions_token" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_sessions_user" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_sessions_expires" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "idx_devcred_user" ON "device_credentials"("user_id");

-- CreateIndex
CREATE INDEX "idx_audit_actor" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "idx_audit_created" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idx_enroll_code" ON "device_enrollments"("code_hash");

-- CreateIndex
CREATE INDEX "idx_enroll_user" ON "device_enrollments"("user_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "provider_api_keys" ADD CONSTRAINT "provider_api_keys_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_enrollments" ADD CONSTRAINT "device_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── 以下为 Prisma schema 无法表达、历来手工维护的对象（归一化时保留）─────────────────────

-- 同帖同 kind 至多一条活跃任务（去重并发兜底；paused 亦计入活跃）。部分唯一索引，schema 无法声明。
CREATE UNIQUE INDEX "uniq_tasks_active_post" ON "tasks" ("post_id", "kind")
  WHERE "status" IN ('queued', 'running', 'paused') AND "post_id" IS NOT NULL;

-- 研判评分 1..5 区间约束。
ALTER TABLE "triage" ADD CONSTRAINT "triage_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5);
