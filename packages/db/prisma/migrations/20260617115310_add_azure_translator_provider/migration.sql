-- AlterEnum
ALTER TYPE "provider_kind" ADD VALUE 'azure';

-- AlterTable
ALTER TABLE "model_providers" ADD COLUMN     "region" TEXT;
