---
name: pipeline-inspector
description: 本仓「流水线检视器 / 逐节点可暂停分析内核」的速查与坑位（reference）。适用场景：改动 apps/api/src/domain/worker 执行器、AnalysisConfigService、/api/analysis/inspect 端点、job_steps / task_stages 表、单帖手动分析、逐节点暂停（paused / step_gate）、检查点重认领逻辑，或排查 inspect 任务卡住 / 漂移时。深入设计见 docs/pipeline-inspector-design.md。
user-invocable: true
---

# 流水线检视器 — 速查（reference skill）

> 碰这个子系统时载入，省得把全文常驻 CLAUDE.md。完整设计：[docs/pipeline-inspector-design.md](docs/pipeline-inspector-design.md)。

## 模型

单帖分析拆成 6 个显式节点逐步执行：

```
resolve → fetch → context → ai_call → normalize → persist
```

每节点产物落 `job_steps` 表。`job_status` 加了 `paused`；`analysis_jobs` 加了 `inspect` / `step_gate`。

## 核心机制：检查点 + 重认领

- 执行器跑完一节点**即落库**；`step_gate` 开 → 置 `paused` 后**正常结束**（不阻塞、不占执行器）。
- 「继续」= 把 job 置 `queued` 重新认领、从下一节点续跑。
- 「等待」交给持久层，执行器**始终无状态**。
- `ai_call` 是唯一**不可重算**的节点（花钱 / 不确定 / 起子进程）→ 必须落检查点；其余节点持久化是为「所见即所跑」（防两次认领间评论被改写致上下文漂移）。

## 坑（改之前必看）

1. 部分唯一索引 `uniq_jobs_active_post` 谓词已扩为 `IN (queued,running,paused)`——**paused 仍占该帖活跃名额**。
2. `resumeInspectJob` 把 `attempts` **归零**——免逐节点重认领累加误触僵死回收。
3. 三 provider 的 `analyze()` 重构为 `callRaw + normalizeRawOutput`——normal 与检视**共用归一化入口**；改 provider 输出处理要两边一致。
4. 执行器（`apps/api/src/domain/worker/`）依赖 `@hatch-radar/shared` 的节点产物契约（`packages/shared/src/inspect.ts`）。

## 落点

- 编排集中在 `AnalysisConfigService`。
- HTTP 端点 `/api/analysis/inspect/*`（很薄）。
- 执行器在 `apps/api/src/domain/worker/`。
