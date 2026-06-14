-- 设备激活码（一次性，短有效期）：管理员「赋予设备」生成，设备端用码 + 公钥换取 device_credentials。
-- 详见 docs/account-rbac-design.md §6.1。纯追加，由 `prisma migrate deploy` 应用。

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('pending', 'consumed', 'revoked');

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

-- CreateIndex
CREATE UNIQUE INDEX "idx_enroll_code" ON "device_enrollments"("code_hash");

-- CreateIndex
CREATE INDEX "idx_enroll_user" ON "device_enrollments"("user_id");

-- AddForeignKey
ALTER TABLE "device_enrollments" ADD CONSTRAINT "device_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 设备凭据补离线宽限窗（天），供验签时滑动续期 expires_at = now + ttl_days*86400。
ALTER TABLE "device_credentials" ADD COLUMN "ttl_days" INTEGER NOT NULL DEFAULT 30;
