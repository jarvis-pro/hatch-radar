-- 数据来源 / 采集连接器入库：监控哪些来源走 sources 表（后台勾选 enabled）；
-- 需鉴权平台（Reddit）的凭据走 source_connectors（加密 JSON，auth_kind 抽象 OAuth/爬虫）。
-- 表为空建；来源列表种子由应用首启 seedSourcesIfEmpty 从代码常量写入（不含任何凭据）。

CREATE TYPE "source_platform" AS ENUM ('reddit', 'hackernews', 'rss');
CREATE TYPE "connector_auth" AS ENUM ('oauth', 'scrape');

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

CREATE UNIQUE INDEX "uniq_sources_platform_ident" ON "sources" ("platform", "identifier");
CREATE INDEX "idx_sources_enabled" ON "sources" ("platform", "enabled");

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

CREATE INDEX "idx_connectors_platform" ON "source_connectors" ("platform");
