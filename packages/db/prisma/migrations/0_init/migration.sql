-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "intensity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "job_trigger" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "provider_kind" AS ENUM ('anthropic', 'openai', 'deepseek');

-- CreateEnum
CREATE TYPE "triage_status" AS ENUM ('pending', 'shortlisted', 'archived');

-- CreateTable
CREATE TABLE "analysis_jobs" (
    "id" SERIAL NOT NULL,
    "post_id" TEXT NOT NULL,
    "provider_id" INTEGER,
    "model" TEXT NOT NULL,
    "trigger" "job_trigger" NOT NULL,
    "status" "job_status" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "enqueued_at" BIGINT NOT NULL,
    "started_at" BIGINT,
    "finished_at" BIGINT,
    "heartbeat_at" BIGINT,

    CONSTRAINT "analysis_jobs_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
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
    "api_key" TEXT NOT NULL,
    "base_url" TEXT,
    "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE INDEX "idx_jobs_post" ON "analysis_jobs"("post_id");

-- CreateIndex
CREATE INDEX "idx_jobs_status" ON "analysis_jobs"("status", "enqueued_at");

-- CreateIndex
CREATE INDEX "idx_comments_post" ON "comments"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_insights_post" ON "insights"("post_id");

-- CreateIndex
CREATE INDEX "idx_insights_intensity" ON "insights"("intensity");

-- CreateIndex
CREATE INDEX "idx_insights_subreddit" ON "insights"("subreddit");

-- CreateIndex
CREATE INDEX "idx_posts_created" ON "posts"("created_utc");

-- CreateIndex
CREATE INDEX "idx_posts_pending" ON "posts"("analyzed_at", "comment_pass");

-- CreateIndex
CREATE INDEX "idx_posts_subreddit" ON "posts"("subreddit");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

