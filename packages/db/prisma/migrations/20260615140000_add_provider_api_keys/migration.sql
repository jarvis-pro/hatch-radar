-- 模型多 Key 故障转移：把 model_providers.api_key 单列拆成子表 provider_api_keys（一对多）。
-- 每条接入配置可挂多把 Key，调用时按 priority 选「启用且健康」的一把，失败即冷却/失效并切换。
-- 本迁移为数据保留型（先把现有密钥搬入子表，再删列），故手写而非纯 schema diff。

-- 1) Key 运行期健康态枚举
CREATE TYPE "api_key_status" AS ENUM ('active', 'cooling', 'invalid');

-- 2) Key 池子表（api_key 仍为 AES-256-GCM 密文）
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

CREATE INDEX "idx_provider_keys_provider" ON "provider_api_keys" ("provider_id");

ALTER TABLE "provider_api_keys"
  ADD CONSTRAINT "provider_api_keys_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "model_providers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) 数据迁移：把每条 model_providers 现有 api_key 搬成一把主 Key（priority 0、active）
INSERT INTO "provider_api_keys"
  ("provider_id", "label", "api_key", "priority", "enabled", "status", "created_at", "updated_at")
SELECT "id", 'primary', "api_key", 0, true, 'active', "created_at", "updated_at"
FROM "model_providers";

-- 4) 删除已迁出的明文密钥列
ALTER TABLE "model_providers" DROP COLUMN "api_key";
