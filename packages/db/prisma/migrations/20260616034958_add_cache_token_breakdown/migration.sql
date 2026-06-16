-- AlterTable
ALTER TABLE "analysis_jobs" ADD COLUMN     "cache_read_tokens" INTEGER,
ADD COLUMN     "cache_write_tokens" INTEGER;
