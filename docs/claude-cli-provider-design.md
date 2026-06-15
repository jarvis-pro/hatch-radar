# Claude 订阅（CLI）模型接入设计

> 给「模型接入」加上 Claude 的**第二种计费通道**：
>
> - 现有 `anthropic` = **API Key 模式**，按 API token 用量计费（走账单）；
> - 新增 `claude_cli` = **订阅模式**，复用跑 worker 那台机器上已登录的 `claude`（Claude Code），
>   吃的是该账号**订阅计划的额度**、**零 API 账单**、**无需 API Key**。
>
> 实现走 `@anthropic-ai/claude-agent-sdk` 的 `query()`（参考 `Work/Demo/demo-claude-extract`），
> **不是** raw `claude -p` 子进程拼接。
>
> 与 [cli-removal-plan.md](cli-removal-plan.md) 无关——那移除的是 `apps/server` 的 `insights/analyze/export`
> 命令子系统（另一个「CLI」）；本设计是给 analyzer 接回「吃订阅额度」这条分析通道。
>
> 范围：Prisma 枚举 + 迁移、`ProvidersRepository` 无 Key 路径、`packages/analysis` 新增 claude-agent
> 处理器、`AnalysisConfigService` 分发/测试分支、settings 控制器校验、web 设置页、catalog 依赖。

## 一、动机与现状

- **现状**：`provider_kind = anthropic | openai | deepseek`（[schema.prisma:485](../packages/db/prisma/schema.prisma)）。其中 `anthropic` **只有 API Key 模式**——[anthropic.ts](../packages/analysis/src/analyzer/anthropic.ts) 用 `@anthropic-ai/sdk` 带解密后的 Key 打 `api.anthropic.com`。每条接入都强制挂 Key，整套多 Key 故障转移/冷却（[providers.repository.ts](../packages/db/src/repositories/providers.repository.ts)、[analysis-config.service.ts](../packages/analysis/src/analysis-config.service.ts)）都围着 API Key 建。
- **缺口**：file 模式时代那个「跑 `claude` 吃订阅额度」的 provider 已随 analyzer 重构一并移除，当前代码无任何 `claude` 调用路径（全仓唯一 `spawn` 在测试 `global-setup.ts`）。
- **目标**：把「吃订阅额度」这条路，以**一等 provider** 形态接回新的队列 / provider 体系，而非旧的 file 复制粘贴回路。

## 二、参考做法（demo-claude-extract）

demo 的核心（`src/extractor.ts`）：

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({
  prompt: text, // 待分析数据 → user 通道
  options: {
    model: env.MODEL, // claude-opus-4-8 等
    systemPrompt: SYSTEM_PROMPT, // 指令 → system 通道
    outputFormat: { type: 'json_schema', schema: INSIGHT_JSON_SCHEMA }, // 强制结构化
    allowedTools: [], // 纯抽取：关掉工具，更快/更省/不弹权限
    maxTurns: 5, // 结构化输出会多占一轮，留余量
    settingSources: [], // 隔离本机/项目设置，保证确定性
  },
})) {
  if (message.type !== 'result') continue;
  if (message.subtype === 'success' && message.structured_output) {
    return message.structured_output as Insight; // ← 结果落在这个字段
  }
  throw new Error(/* subtype 非 success 或缺 structured_output → 失败 */);
}
```

要点：

1. `query()` 内部拉起本机 Claude Code，**复用登录态、无需 `ANTHROPIC_API_KEY`** → 吃订阅额度。
2. 结构化结果在 `result` 消息的 `structured_output`，不用自己抠 JSON。
3. 用量/费用现成：`message.usage`（`input_tokens`/`output_tokens`/`cache_*`）、`total_cost_usd`、`num_turns`、`duration_ms`。
4. **与 hatch-radar 同源**：demo 就是本 analyzer 的精简版，`pain_points/opportunities/tags` 同一套 schema、System Prompt 同一形态。所以新处理器 ≈ 把 [anthropic.ts](../packages/analysis/src/analyzer/anthropic.ts) 的传输层从 `messages.create` 换成 `query()`，**schema / prompt / normalize 全部复用**。

## 三、建模：新增枚举值 `claude_cli`（方案 A）

选 A 而非「`anthropic` + `auth_kind` 子开关」，因为整条分发链路（`createProcessor` / `providerConfigWithKey` / UI `PROVIDER_LABEL`）本就 `switch (provider_kind)`，加一支最贴合、改动面最小。

`claude_cli` 的语义：

| 维度       | `anthropic`（现有）                   | `claude_cli`（新增）                       |
| ---------- | ------------------------------------- | ------------------------------------------ |
| 传输       | `@anthropic-ai/sdk` `messages.create` | `@anthropic-ai/claude-agent-sdk` `query()` |
| 计费       | API token 账单                        | 订阅计划额度                               |
| API Key    | 必填（Key 池 + 故障转移）             | **无**（Key 池恒空）                       |
| `base_url` | 可选                                  | **无意义**（恒 null）                      |
| `model`    | 用                                    | 用（`claude-opus-4-8` 等）                 |
| 运行进程   | worker                                | worker（且宿主机须装 `claude` 并已登录）   |

> **命名**：枚举取 `claude_cli`，贴合你「claude 命令行」的心智；实现其实是 Agent SDK。若更想强调"是 SDK 不是裸命令"，可改 `claude_agent`——一句话能换，等你定。

## 四、数据层改动

1. **枚举 + 迁移**：[schema.prisma:485](../packages/db/prisma/schema.prisma) 的 `provider_kind` 加 `claude_cli`，走 `prisma migrate`（仅加枚举值，向后兼容）。
2. **无 Key 接入**：`ProvidersRepository.createProvider(input, firstKey, now)`（[providers.repository.ts:172](../packages/db/src/repositories/providers.repository.ts)）把 `firstKey` 改 `string | null`——为 `null` 时事务内**不插 Key 行**。settings 控制器对 `claude_cli` 传 `null`。
3. **不适用的路径**：`updateProviderAndResetKeys`（改 base_url 强制重填密钥的安全闸）、全部 Key 池端点（增删改 Key）对 `claude_cli` 都不适用——前端不暴露、控制器对 `claude_cli` 直接拒绝。

## 五、分析层改动

1. **`AnalysisConfig` union** 加一支（[analyze.ts:10](../packages/analysis/src/analyzer/analyze.ts)）：`{ provider: 'claude_cli'; model: string }`（无 `apiKey`）。
2. **`createProcessor`** 加 `case 'claude_cli'`（[analyze.ts:37](../packages/analysis/src/analyzer/analyze.ts)）→ 调 `analyzeWithClaudeAgent(cfg.model, post, comments, signal)`。
3. **新文件** `packages/analysis/src/analyzer/claude-agent.ts`（仿 [anthropic.ts](../packages/analysis/src/analyzer/anthropic.ts)）：
   - `analyzeWithClaudeAgent(model, post, comments, signal?)`：`buildUserPrompt(buildContext(post, comments))` 拼 user 文本 → `query({...})`（options 照第二节）→ 取 `result.success.structured_output` → **复用 `normalizeInsight()`**。
   - `testClaudeAgent(model)`：极小 `query()` 验证本机 `claude` 可用（连通性测试）。
   - **abort 接入**：确认 `query()` 的中止方式（options 的 `abortController` 或生成器的 `interrupt()`），让 job 超时能取消子进程——对齐现有 `signal` 语义。
4. **`AnalysisConfigService`（关键分叉）**：
   - `getProcessorForProvider`（[analysis-config.service.ts:128](../packages/analysis/src/analysis-config.service.ts)）：`claude_cli` 走**「无 Key 直连」**分支，直接 `createProcessor({ provider:'claude_cli', model })`，**绕开 `analyzeWithFailover` / `listUsableKeys`**（否则会因「0 把可用 Key」抛错）。
   - `testProvider`（[:272](../packages/analysis/src/analysis-config.service.ts)）：`claude_cli` 直接 `testClaudeAgent(model)`，不查 Key。
   - `getActiveProvider` / `enqueueAutoAnalysisRound` / `enqueueManualRun`：只用 `model` + `enabled`，天然兼容，无需改。

## 六、API 与前端

1. **settings 控制器**（`apps/api` settings.controller.ts）：
   - `POST/PUT /api/settings/providers`：`claude_cli` 时 `apiKey` / `baseUrl` 可缺省（忽略），`createProvider(firstKey = null)`；Key 池子端点对 `claude_cli` 直接拒绝。
   - `PUT /api/settings/active` 的「可用 Key 校验」：`claude_cli` 视为**恒可用**（无 Key 概念）。
2. **web 设置页**（[settings-manager.tsx](../apps/web/src/components/settings-manager.tsx)）：`PROVIDER_LABEL` / `PROVIDER_DEFAULTS` 加 `claude_cli`（标签如「Claude（订阅 / Claude Code）」，默认 `model: 'claude-opus-4-8'`）；**选中 `claude_cli` 时隐藏 API Key + Base URL 输入框与整个 Key 池管理区块**；「测试连通性」按钮复用。

## 七、依赖与运维

- **依赖**：`@anthropic-ai/claude-agent-sdk`（pin `^0.3.177`）**inline 进 `packages/analysis/package.json`**——它只有 analysis 单一消费方，按本仓 catalog 约定（仅收录 2+ 包共享项）不入 catalog，与同包的 `@anthropic-ai/sdk` 一致。
- **运维前置（硬约束）**：跑 **worker** 的机器必须装 `claude` 且**已登录**（订阅态）；否则 `claude_cli` 的 job 必败。文档化为部署前置条件。
- **隔离**：`allowedTools: []` + `settingSources: []` 必设，避免 `query()` 读到 worker 自身的 `CLAUDE.md` / 项目设置而污染输出。
- **限流**：订阅 5 小时滚动窗触发即 `query()` 抛错 → 交给现有队列**超时/重试/僵死回收**兜底；Key 冷却那套不适用。

## 八、不做 / 取舍

- **不做 seed**：`claude_cli` 由管理员在设置页添加（与「provider 用户自建、无 provider seeder」现状一致；且 seed 时 worker 未必已登录，自动种子无意义）。
- **不做 Key 池 / 故障转移**：订阅无多 Key 概念。
- **不在 API 进程跑 `query()`**：只在 worker（数据面）；API 仅负责配置与入队。

## 九、影响面

| 类别 | 内容                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新增 | `provider_kind` 枚举值 `claude_cli` + 迁移；`packages/analysis/src/analyzer/claude-agent.ts`（`analyzeWithClaudeAgent` + `testClaudeAgent`）；catalog 依赖 `@anthropic-ai/claude-agent-sdk`                                                                                                |
| 修改 | `analyze.ts`（union + `createProcessor` 分支）；`analysis-config.service.ts`（`getProcessorForProvider` / `testProvider` 无 Key 分支）；`providers.repository.ts`（`createProvider` 的 `firstKey` 可空）；settings 控制器（校验 + active 校验）；`settings-manager.tsx`（选项 + 字段显隐） |
| 复用 | `INSIGHT_JSON_SCHEMA` / `SYSTEM_PROMPT` / `buildUserPrompt` / `buildContext` / `normalizeInsight`；队列、热重载、入队、active 状态机                                                                                                                                                       |
| 不动 | Key 池端点与故障转移逻辑（对 `anthropic`/`openai`/`deepseek` 不变）；crawler；mobile                                                                                                                                                                                                       |

## 十、验收

- `pnpm -r typecheck` 与 `pnpm lint` 全绿。
- 新增 `claude-agent` 单测（mock `query()` 的消息流：success+structured_output / 缺 structured_output / error subtype）。
- 双进程冒烟：设置页加一条 `claude_cli` → 设为 active → worker 起一轮 → 落出洞察（本机已 `claude` 登录前提下）。
- 迁移可回滚（仅加枚举值；回滚前需确保无 `claude_cli` 行引用）。

## 十一、落地步骤与状态

> 顺序：先数据层（枚举/迁移/无 Key 接入）打底 → 再分析层（处理器 + 分发分支）→ 最后 API/前端串起来。**已一次性全部落地。**

- [x] Step 1 — schema.prisma 加 `claude_cli` + 迁移 `20260615174944_add_claude_cli_provider`（`ALTER TYPE "provider_kind" ADD VALUE 'claude_cli'`，已应用 dev+test 库并 `prisma generate`）；`createProvider` 的 `firstKey` 改 `string | null`（null 不插 Key 行）
- [x] Step 2 — 新增 `claude-agent.ts`（`analyzeWithClaudeAgent` + `testClaudeAgent` + 纯函数 `insightFromMessage`）；`@anthropic-ai/claude-agent-sdk` **inline 进 packages/analysis**；`AnalysisConfig` union + `createProcessor` 加 `case 'claude_cli'`
- [x] Step 3 — `getProcessorForProvider` / `testProvider` 的无 Key 分支（绕开 `analyzeWithFailover` / `listUsableKeys`）；abort 经 `query()` 的 `options.abortController`（外部 signal 桥接）；`providerConfigWithKey` / `runKeyTest` 补 `claude_cli` 分支以满足穷尽性
- [x] Step 4 — settings 控制器：`providerKind` zod 加 `claude_cli`、`apiKey` 转可选；create/update 对 `claude_cli` 免 Key/baseUrl/secret、`addKey` 拒绝、`setActive` 可用 Key 校验放行
- [x] Step 5 — web 设置页：下拉加选项、`claude_cli` 时藏 Key/baseUrl 输入与 Key 池区块、免首把 Key 校验、「新增模型」不再依赖 secret
- [x] Step 6 — 验证：`pnpm -r typecheck` 12/12 + `pnpm lint` 全绿；`apps/api` vitest **55/55**（新增 `claude-agent` 分发 4 例 + analysis-config 无 Key 分发 + settings-controller 免 Key/拒 Key）

> **偏差记录（与上文设计的出入）：**
> - 依赖入 **inline** 而非 catalog（§七 已订正）——单消费方按约定不入 catalog。
> - 单测改用纯函数 `insightFromMessage` 覆盖 result 分发，**未用「mock query()」**：SDK 经子进程跑 claude，跨 inlined 工作区包边界 `vi.mock` 拦不住（实测会真起 claude、12s+/次），故抽纯函数测分发，query() 串接交给冒烟。
> - **双进程真起 claude 的端到端冒烟未自动跑**：需 worker 本机已登录 claude 且会真实吃订阅额度，留作手动验证。

> 约定：每条改动后跑对应预检查（`typecheck` / 涉及 DB 跑 `test`）；按主题分组提交（Conventional Commits，中文）。
