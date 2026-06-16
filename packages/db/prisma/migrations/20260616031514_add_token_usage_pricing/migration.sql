-- AlterTable
ALTER TABLE "analysis_jobs" ADD COLUMN     "input_tokens" INTEGER,
ADD COLUMN     "output_tokens" INTEGER;

-- AlterTable
ALTER TABLE "model_providers" ADD COLUMN     "input_price" DOUBLE PRECISION,
ADD COLUMN     "output_price" DOUBLE PRECISION;
