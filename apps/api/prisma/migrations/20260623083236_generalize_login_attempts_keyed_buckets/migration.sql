/*
  login_attempts 主键从 email 泛化为 key（统一承载 `email:` / `ip:` 双维限流桶）。

  该表仅承载瞬态限流计数（锁定 5min / 滑动窗 15min），清空无业务影响。
  旧 email 行无法平滑迁为带前缀的新键，且短期即重建，故先清表再换主键列，
  规避「向非空表新增 NOT NULL 列」失败（见下方 Prisma 警告）。

  Warnings:
  - The primary key for the `login_attempts` table will be changed.
  - You are about to drop the column `email` on the `login_attempts` table.
  - Added the required column `key` to the `login_attempts` table without a default value.
*/

-- 清空瞬态限流计数（旧 email 主键行不再适用新键格式，短期内自然重建）
DELETE FROM "login_attempts";

-- AlterTable: email(PK) -> key(PK)
ALTER TABLE "login_attempts" DROP CONSTRAINT "login_attempts_pkey",
DROP COLUMN "email",
ADD COLUMN     "key" TEXT NOT NULL,
ADD CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("key");
