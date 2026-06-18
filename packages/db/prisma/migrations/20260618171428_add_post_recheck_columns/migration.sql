-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "last_rechecked_at" BIGINT,
ADD COLUMN     "recheck_due_sweep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recheck_misses" INTEGER NOT NULL DEFAULT 0;
