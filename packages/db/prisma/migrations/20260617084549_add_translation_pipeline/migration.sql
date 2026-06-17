-- CreateEnum
CREATE TYPE "job_kind" AS ENUM ('analysis', 'translation');

-- CreateEnum
CREATE TYPE "translation_field" AS ENUM ('post_title', 'post_selftext', 'comment_body');

-- CreateEnum
CREATE TYPE "translation_status" AS ENUM ('pending', 'translating', 'done', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "analysis_jobs" ADD COLUMN     "job_type" "job_kind" NOT NULL DEFAULT 'analysis';

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "body_hash" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "selftext_hash" TEXT,
ADD COLUMN     "title_hash" TEXT;

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

-- CreateIndex
CREATE UNIQUE INDEX "idx_translations_hash" ON "translations"("content_hash");

-- CreateIndex
CREATE INDEX "idx_translations_status" ON "translations"("status");

-- ─────────────────────────────────────────────────────────────────────────
-- 部分唯一索引随 job_type 升级（Prisma schema 无法表达部分索引，由本迁移手工维护，
-- prisma migrate diff 看不见它、不会判为 drift 删除；沿 0_init 同一约定，勿删）。
-- 由「同帖至多一条活跃任务」升级为「同帖每种 job_type 至多一条活跃任务」——
-- 使分析与翻译互不挤占（同帖可同时有一条 queued/running 分析 + 一条 queued/running 翻译）。
-- 旧约束更严（同帖仅一条），存量数据天然满足新约束，重建安全。
-- ─────────────────────────────────────────────────────────────────────────
DROP INDEX "uniq_jobs_active_post";
CREATE UNIQUE INDEX "uniq_jobs_active_post"
  ON "analysis_jobs" ("post_id", "job_type")
  WHERE "status" IN ('queued', 'running');
