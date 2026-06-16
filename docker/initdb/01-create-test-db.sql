-- 集成测试库（与开发库 hatch_radar 隔离，避免测试 TRUNCATE 冲掉开发数据）。
--
-- 仅在数据卷「首次初始化」（空卷）时由 postgres 镜像自动执行；新库 owner 默认即 POSTGRES_USER（radar）。
-- 建库后表结构由 vitest globalSetup（apps/api/test/global-setup.ts）用 `prisma migrate deploy` 落齐。
-- 已有旧卷需手动补建：docker compose exec db createdb -U radar hatch_radar_test
CREATE DATABASE hatch_radar_test;
