---
name: translation
description: 本仓「内容翻译管线」的速查与坑位（reference）。适用场景：改动翻译 provider（claude_cli / azure）、translations 表、译文寻址（按源内容哈希）、翻译入队（job_type=translation）、apps/api/src/lib/analysis/translator/ 目录、/api/translations 端点，或排查译文缓存 / Key 池故障转移时。深入设计见 docs/translation-pipeline-design.md。
user-invocable: true
---

# 翻译管线 — 速查（reference skill）

> 碰翻译子系统时载入。完整设计：[docs/translation-pipeline-design.md](docs/translation-pipeline-design.md)。

## Provider 两档

| provider     | 性质                       | 计费     | 能力                                                    |
| ------------ | -------------------------- | -------- | ------------------------------------------------------- |
| `claude_cli` | 订阅复用本机已登录 Claude  | 零边际   | 高质量；分析 + 翻译都能                                 |
| `azure`      | Azure Translator 机翻      | 按字符   | **仅翻译**；走 Key 池故障转移；`region` 填区域码如 `centralus` |

## 关键约定

- 译文按**源内容哈希**存 `translations` 表——扛 `replaceComments` 的 churn，不按帖子 id 直存。
- 走分析**同一队列**：`analysis_jobs.job_type=translation`。
- **默认不翻**，按需触发（首次 / 增量靠 `content_hash` 缓存）。主要消费方是移动端。
- Key 池与分析**共用** `apps/api/src/lib/analysis/key-failover.ts`（状态机 `active/cooling/invalid`）。

## 坑

- `azure` **仅翻译**：`setActive` 会拒它、分析路径 `providerConfigWithKey` 对它抛错——别在分析里选 azure。
- **Claude Agent SDK 不可 mock**（`vi.mock` 拦不住、会真起 claude）→ 把消息分发抽成纯函数 `translationFromMessage` 单测，勿测真实调用。

## 落点

- 能力代码：`apps/api/src/lib/analysis/translator/`。
- HTTP 端点：`/api/translations/*`。
