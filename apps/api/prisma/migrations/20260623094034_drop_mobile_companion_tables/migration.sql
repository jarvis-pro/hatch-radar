/*
  Warnings:

  - You are about to drop the `device_credentials` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `device_enrollments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sync_ops` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "device_credentials" DROP CONSTRAINT "device_credentials_user_id_fkey";

-- DropForeignKey
ALTER TABLE "device_enrollments" DROP CONSTRAINT "device_enrollments_user_id_fkey";

-- DropTable
DROP TABLE "device_credentials";

-- DropTable
DROP TABLE "device_enrollments";

-- DropTable
DROP TABLE "sync_ops";

-- DropEnum
DROP TYPE "device_status";

-- DropEnum
DROP TYPE "enrollment_status";
