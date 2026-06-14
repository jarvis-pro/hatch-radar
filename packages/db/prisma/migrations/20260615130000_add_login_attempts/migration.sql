-- 登录失败限流表：按邮箱累计失败次数 + 锁定截止，挡暴力破解（落表持久）。纯追加。

-- CreateTable
CREATE TABLE "login_attempts" (
    "email" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" BIGINT,
    "last_attempt_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("email")
);
