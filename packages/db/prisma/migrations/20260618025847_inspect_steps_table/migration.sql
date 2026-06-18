-- AlterTable
ALTER TABLE "analysis_jobs" ADD COLUMN     "inspect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "step_gate" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "job_steps" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input_summary" JSONB,
    "output" JSONB,
    "error" TEXT,
    "started_at" BIGINT,
    "finished_at" BIGINT,

    CONSTRAINT "job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_job_steps_job" ON "job_steps"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_job_steps_job_seq" ON "job_steps"("job_id", "seq");
