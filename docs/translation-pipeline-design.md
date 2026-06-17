# 内容翻译管线设计（按需 / 移动端优先 / 零边际成本）

> 给抓取内容（标题 / 正文 / 评论）加上**译成中文**的能力，服务"各国各地区语言导致审核阅读门槛高"的问题。
>
> 三条定性决策（与初版"全量自动翻译 + 免费 Key 池"相比已重定向）：
>
> - **消费方是移动端，不是 web**：web 用浏览器翻译插件即可白看；移动端离线、AI 在服务端，事后无法自译 → 译文必须**服务端物化、随导出产物一起进移动端**。
> - **默认不翻、按需触发**：帖子存在未翻译内容才显示「翻译」按钮，区分**首次**与**增量**（评论刷新后新增的未翻部分）。量级因此从"全量 ~30 亿字符/月"坍缩到"真正导出的那批"。
> - **零边际成本 + 最高质量 = 复用 `claude_cli`**：订阅额度已付费，翻译走它即零额外账单；LLM →中文是当前最高质量且天生保留 markdown/代码/俚语。**不**搭建多账号免费层 Key 农场（量级不需要、违反 ToS、易封号）。
>
> 复用既有设施：任务队列（[jobs.repository.ts](../packages/db/src/repositories/jobs.repository.ts)）、`claude_cli` 处理器（[claude-cli-provider-design.md](claude-cli-provider-design.md)）、运行期配置中心、成本面板。**零改动现有分析链路。**
>
> 范围：Prisma 新表/枚举 + 迁移、`packages/analysis` 新增 translator、worker 新增 translation job 分支、settings 控制器、web 翻译按钮、移动端导出携带译文。

## 一、动机与现状

- **问题**：抓取源（Reddit/HN）含多国语言，审核员阅读门槛高。web 端可用浏览器内置翻译临时解决；**移动端**（[mobile-companion](../apps/mobile)，离线 RN app、AI 在服务端）没有浏览器插件，且导入后处于离线态 → 看不懂就是看不懂。
- **真正诉求**：把数据**导入移动端时阅读更方便**。即翻译能力本质是为**导出→移动端**这条管线备料，而非为 web 在线阅读。
- **现状缺口**：
  - [posts](../packages/db/prisma/schema.prisma) / [comments](../packages/db/prisma/schema.prisma) 无任何语言 / 译文字段。
  - 但 `posts.export_locked_at`（[schema.prisma:248](../packages/db/prisma/schema.prisma)）已是**导出冻结的预留列**——导出管线的钩子已埋。
  - `claude_cli` provider 已落地（[claude-cli-provider-design.md](claude-cli-provider-design.md)）：worker 本机 `query()` 吃订阅额度、无 Key、结构化输出现成。
  - 任务队列（认领/心跳/超时/僵死回收/成本）已通用化，仓储即叫 `JobsRepository`。
- **目标**：以**按需、解耦、可缓存**的形态接入翻译，最大化复用上述设施。

## 二、设计原则（关键决策）

| 决策                                                       | 取舍                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **默认不翻，按钮触发**                                     | 量级总开关。绝大多数长尾评论无人阅读，不预翻。                                                                                                                                                        |
| **解耦的翻译 job，绝不抓取时同步翻**                       | 抓取/入库跑在调度进程（[scheduler.service.ts](../apps/api/src/domain/scheduler/scheduler.service.ts) `scan`），同步塞翻译会被 API 延迟/限流拖垮；翻译是重活，归 worker + 队列。                       |
| **译文按 `content_hash` 寻址，不挂列在 posts/comments 上** | [comments.replaceComments](../packages/db/src/repositories/comments.repository.ts) 是**整删整插**，挂列每次刷评论即被清空；按内容哈希寻址则 ①扛 churn ②同文去重 ③**未命中=需翻译**统一判定首次/增量。 |
| **`claude_cli` 为默认翻译 provider，模型档与分析独立**     | 零边际成本（订阅额度）+ 最高质量 + 已集成 + 原生保留结构；翻译可选更省档。注：同账号仍共享订阅额度，见 §7 护栏。                                                                                      |
| **目标语固定中文**                                         | `content_hash` 单键唯一即可，暂不引入多目标语维度。                                                                                                                                                   |
| **不做免费层多账号 Key 池**                                | 低频量级不需要；违反 ToS、易封号。需要省额度时用**单个合规免费层 MT** 作溢出即可。                                                                                                                    |

## 三、数据建模

### 3.1 新表 `translations`（译文缓存）

```prisma
/// 译文缓存：抓取内容译成中文的结果，按源文本内容哈希寻址（见 §2 取舍）。
model translations {
  id            Int                @id @default(autoincrement())
  /// sha256(decode 后规范化的源文本)；缓存键 + 增量探测器。
  content_hash  String             @unique(map: "idx_translations_hash")
  /// 源字段：post_title | post_selftext | comment_body（仅标注来源，不参与寻址）。
  source_field  translation_field
  /// 检测出的源语种(ISO 639-1，如 en/ja)；判定为 zh 则 status=skipped。
  source_lang   String?
  /// 中文译文（status=done 时非空）。
  text          String?
  /// 产出译文的 provider 类型 / 软引用 id。
  provider_kind provider_kind?
  provider_id   Int?
  /// pending→translating→done/failed；skipped=源即中文无需翻译。
  status        translation_status @default(pending)
  /// 源字符数（MT 按字符计费；claude_cli 走订阅额度，成本显示「—」）。
  char_count    Int?
  last_error    String?
  created_at    BigInt
  updated_at    BigInt
}

enum translation_field  { post_title  post_selftext  comment_body }
enum translation_status { pending  translating  done  failed  skipped }
```

### 3.2 源表加哈希列（驱动"未翻译?"查询与按钮状态）

- `posts`：`title_hash String?`、`selftext_hash String?`（链接帖 selftext 为空串 → 该列 null，跳过）。
- `comments`：`body_hash String?`。
- **写入时机**：入库时计算，**在 decode 之后**（与 [context.ts `decodeHtmlEntities`](../packages/analysis/src/analyzer/context.ts) / [hackernews `decodeHtml`](../packages/crawler/src/hackernews.ts) 的解码顺序一致，保证哈希基于干净文本）。落在 [posts.upsertPosts](../packages/db/src/repositories/posts.repository.ts) / [comments.replaceComments](../packages/db/src/repositories/comments.repository.ts) 内，是既有"派生字段"模式的延伸。
- 索引 `body_hash` / `title_hash`，使"某帖有无未翻内容"成为一次索引 join。

### 3.3 "未翻译内容"判定（首次 vs 增量，免写检测逻辑）

```sql
-- 某帖待翻译条目 = 哈希在 translations 里无 done/skipped 记录的源文本
SELECT c.id, c.body_hash
FROM comments c
LEFT JOIN translations t ON t.content_hash = c.body_hash AND t.status IN ('done','skipped')
WHERE c.post_id = $1 AND t.id IS NULL;   -- 0 行=已全翻；多行=首次；少量=增量
```

> **为什么增量是免费的**：`replaceComments` 整删整插，但 body 未变 → 哈希未变 → 命中既有译文，无需重翻；新评论 → 新哈希 → 缓存未命中 → 正是"增量"。无需任何额外的变更检测代码，与现有 `comments_changed_at` 指纹思路同源。

## 四、翻译链路（worker）

### 4.1 队列：`analysis_jobs` 通用化为 `jobs` + `job_type`（方案 A）

- 现 [analysis_jobs](../packages/db/prisma/schema.prisma) 加 `job_type job_kind @default(analysis)`，枚举 `job_kind { analysis translation }`；表重命名为 `jobs`（仓储已叫 `JobsRepository`，命名零违和）。
- **关键迁移**：部分唯一索引 `uniq_jobs_active_post` 由 `UNIQUE(post_id) WHERE status IN (queued,running)` 改为 **`UNIQUE(post_id, job_type) WHERE …`**——使同帖可同时有一条分析 + 一条翻译活跃任务（迁移末尾手工维护，沿 0_init 约定，勿删）。
- `char_count` 计费：claude_cli 复用 `input/output_tokens` + `usage`；MT 溢出 provider 走字符 → 在成本聚合按 `job_type` 分流（见 §7）。
- 入队/认领/心跳/超时/僵死回收**全部复用** [jobs.repository.ts](../packages/db/src/repositories/jobs.repository.ts) 与 [worker.service.ts](../apps/worker/src/worker.service.ts)。`runJob` 按 `job_type` 分发到 `runTranslationJob`。

> 备选方案 B（独立 `translation_jobs` 表）复制度更高、worker 需第二条认领循环，**不推荐**。

### 4.2 翻译处理器（仿 analyzer 结构，`packages/analysis/src/translator/`）

- 镜像 [analyzer/](../packages/analysis/src/analyzer)：`translate.ts`（按 `provider_kind` 分发）、`claude-agent.ts`（`translateWithClaudeAgent`）、`translation-schema.ts`、`prompt.ts`。
- **结构化批量翻译**（复用 `claude_cli` 的 `outputFormat: json_schema`，免抠 JSON）：输入 `{ key: content_hash, text }[]`，输出 `{ key, zh }[]`，逐条回写 `translations`。
- **System Prompt 要点**：译成简体中文；**原样保留** markdown / 代码块 / URL / `@提及` / 引用；不翻译代码标识符；保留讽刺/语气。
- **语言检测短路**：worker 端轻量本地检测（如 `franc`/CLD），判定 zh 的条目直接 `status=skipped`、不调模型（省额度），`source_lang` 落库供展示。
- **分块**：长评论树按上下文窗口切批；增量翻译可携带父/兄弟评论作只读上下文提质（不重翻）。
- **`claude_cli` 复用既有约束**（见 [claude-cli-provider-design.md §五/§七](claude-cli-provider-design.md)）：绕开 `analyzeWithFailover`/`listUsableKeys`（无 Key）、`allowedTools:[] settingSources:[]` 隔离、abort 经 `options.abortController` 桥接 job 超时。
- **可测性**：抽纯函数 `translationFromMessage(message)` 测分发——`vi.mock` 拦不住该 SDK（会真起 claude），同 `insightFromMessage` 踩过的坑。

### 4.3 翻译 provider / 模型档（独立可配）

- 设置页**单独指定翻译 provider 与模型**，与分析解耦（默认 `claude_cli` + 一个更省额度的模型档，如 Sonnet/Haiku；分析仍可用 Opus）。
- **额度提示**：若翻译与分析同为 `claude_cli`（同一登录账号），换更轻模型只降单次消耗、**不另开额度池**——二者仍共享同一订阅滚动窗，故仍需 §7 护栏；要彻底错开额度，把翻译 provider 指向**另一账号 / MT 溢出 provider**。

## 五、触发与交互（web）

- **默认不翻**。帖子存在未翻译内容（§3.3 查询 >0 行）→ 详情页显示按钮：
  - 无任何译文 → `翻译 · 首次 (N 条)`
  - 已翻 + 有新增 → `翻译增量 (M 条新评论)`
  - 全部 done → 隐藏 / `已翻译 ✓`（可「重新翻译」）
- 点击 → `POST /api/translations/posts/:id`：入队一条 translation job（`uniq_jobs_active_post (post_id, job_type)` 兜底重复点击）；小增量近实时，首次大批显示「翻译中」进度。
- **选模型**（未设默认翻译/active 模型时）：点击不报错，而是弹出小菜单从 `GET /api/translations/providers` 返回的 Claude 订阅模型中选一个，本次 `POST` 带 `providerId` 一次性指定（仍仅需 `analyze:run`，不动全局设置）；有默认模型则直接翻译。无任何 claude_cli 模型时按钮禁用并提示去设置页配置。
- **定位**：web 日常用浏览器翻译看即可；此按钮主要用于**给移动端导出备料**。

## 六、移动端导出集成（本功能的真正目的）

- **导出携带译文**（分字段，不与原文混存）：导出 / [`/api/insights/import`](../apps/api) 的 payload 中，源内容附 `*_zh` 字段（由 `content_hash` join `translations` 取 done 译文）。
- **导出时确认框（折中）**：导出选定帖子时若存在未翻译条目，弹确认框给操作员选——**①直接导出**（带原文/部分译文）或 **②补全翻译后导出**（入队缺失条目、显示进度，翻齐自动继续打包）。框内显示待翻帖数/条数。与 `posts.export_locked_at` 冻结语义对齐（冻结期内容稳定，译文可一次性补全）。
- **移动端渲染**：中文优先 + 原文可切换核对（[mobile UI 约定](../apps/mobile) NativeWind，无 StyleSheet）。

## 七、成本与运维

- **claude_cli 共享额度**：分析 + 翻译走同一登录账号 → 共用**同一订阅滚动窗（5h/周）**，与所选模型档无关。风险场景：一次导出 50 帖触发 50 条翻译 → 烧穿窗口 → **核心分析管线被限流停摆数小时**（虽有队列重试兜底）。成本面板对订阅模式仍显示「—」。
- **护栏（默认 A+B）**：**A 优先级**——`claimNextJob` 按 `job_type` 让分析先于翻译认领，翻译只用余量、绝不饿死核心管线（ORDER BY 一处改动）；**B 翻译并发上限**——运行期设置 `translationConcurrency`（默认 1），挡导出洪峰独占窗口。**C（可选）彻底错开**：翻译 provider 指向另一账号 / MT，零共享额度。
- **MT 溢出（可选）**：单个合规免费层（如 Azure 月免 200 万字符），接入即复用既有 [provider_api_keys](../packages/db/prisma/schema.prisma) 池与 `active/cooling/invalid` 故障转移——按字符计费，成本面板按 `job_type` 拆"分析/翻译"两条线。
- **反向饥饿**：护栏 A 让分析优先后，持续的分析洪峰可能使按需翻译迟迟不跑；操作员在等的翻译可经"手动触发"临时插队（或由 B 的并发名额保证至少 1 条翻译在跑）。

## 八、不做 / 取舍

- **不做**多账号免费层 Key 农场（违反 ToS、易封号、低频量级不需要）。
- **不做**多目标语（固定中文；将来需要再加 `target_lang` 维度，表结构可平滑扩展）。
- **不做**抓取即全量自动翻译（成本与额度黑洞）。
- **不在** API 进程跑翻译（仅 worker，同 `claude_cli` 约束）。
- **不做**抓取时同步翻译（耦合抓取吞吐）。

## 九、影响面

| 类别 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 | 表 `translations` + 枚举 `translation_field`/`translation_status`/`job_kind` + 迁移；源表哈希列；`packages/analysis/src/translator/*`；`runTranslationJob`（worker）；`/api/translations/*` 控制器；web 翻译按钮组件                                                                                                                                                                                                                                    |
| 修改 | `analysis_jobs`→`jobs` + `job_type` + 改部分唯一索引；[jobs.repository.ts](../packages/db/src/repositories/jobs.repository.ts)（入队带 type、`claimNextJob` 按 type 优先级、成本按 type 分流）；[worker.service.ts](../apps/worker/src/worker.service.ts)（按 type 分发、`translationConcurrency` 上限）；入库路径补哈希列；settings 加翻译 provider/模型档选择 + 运行期 `translationConcurrency`；导出加未翻确认框 + payload 加 `*_zh`；移动端阅读视图 |
| 复用 | `claude_cli` 处理器范式 / `query()` 结构化输出 / `buildContext`；队列认领/心跳/超时/回收；运行期配置；成本面板；故障转移（MT 溢出时）                                                                                                                                                                                                                                                                                                                   |
| 不动 | 现有分析链路（insight 产出不变）；crawler 抓取逻辑；账户/RBAC                                                                                                                                                                                                                                                                                                                                                                                           |

## 十、验收

- `pnpm -r typecheck` 与 `pnpm lint` 全绿。
- 单测：`translationFromMessage` 分发（success/缺字段/error）；§3.3 "未翻译内容"查询；首次→增量哈希命中/未命中。
- 双进程冒烟：web 点「翻译」→ worker 起 translation job → `translations` 落 done → 详情页可切中文（本机已登录 claude 前提）。
- 增量验证：刷出新评论 → 按钮变「翻译增量 (M)」→ 只翻新增、旧译复用。
- 导出验证：导出含未翻帖 → 弹确认框（直接导出 / 补全后导出）→ 选补全则翻齐再打包、payload 带 `*_zh` → 移动端中文展示。

## 十一、落地步骤与状态

> 顺序：数据层（表/枚举/哈希列/队列通用化）→ 翻译链路（translator + worker 分发）→ web 按钮 → 移动端导出携带译文。**已落地（分支 feat/translation-pipeline）。**

- [x] Step 1 — Prisma：新增 `translations` + 三枚举（job_kind/translation_field/translation_status）；源表加哈希列；`analysis_jobs` 加 `job_type` + 改 `uniq_jobs_active_post` 为 `(post_id, job_type)`；迁移 `20260617084549_add_translation_pipeline`（含手工部分索引）已应用 dev+test 库。
- [x] Step 2 — 入库补哈希：`contentHash` 工具 + `upsertPosts`/`replaceComments` 写 `title_hash`/`selftext_hash`/`body_hash`；新增 `TranslationsRepository`。
- [x] Step 3 — translator：`packages/analysis/src/translator/*`（`translateBatchWithClaudeAgent` + 纯函数 `translationFromMessage` + 结构化 schema + prompt）+ `TranslationService` + `looksChinese` 中文短路。
- [x] Step 4 — worker：`runJob` 按 `job_type` 分发 `runTranslationJob`；`claimNextJob` 分析优先 + `translationConcurrency` 上限（护栏 A+B，Gateway 传参）。
- [x] Step 5 — API/设置：`/api/translations/posts/:id`（GET 状态 / POST 入队）+ `/content`（已译内容）；`translationConcurrency` 校验 + 翻译 provider 选用端点；成本聚合按 `job_type='analysis'` 隔离。
- [x] Step 6 — web：详情页翻译按钮（首次/增量/已翻/翻译中状态机）+ 原文/中文切换（正文 + 评论树，译文视图 context）。
- [x] Step 7 — 导出：未翻 `.sqlite` 导出前内联确认；导出 `translations` 表（按实体寻址）随产物带出；移动端导入 + 中文优先渲染（含切换）。
- [x] Step 8 — 验收：typecheck 12/12 + lint 干净 + 测试 103 全过（kernel5/crawler12/analysis10/api76，含新增 `translationFromMessage`/`looksChinese`/导出译文用例）；api 启动冒烟 DI 解析、三路由映射通过（仅因已有实例占端口 47878 报 EADDRINUSE，非代码问题）。

> **偏差记录（与上文设计的出入）：**
>
> - **不重命名物理表**：保留 `analysis_jobs` 表名仅加 `job_type` 列（方案 A 的务实变体）——重命名会牵动大量 raw SQL 与 `Prisma.analysis_jobsWhereInput` 类型，收益仅命名；仓储类已叫 `JobsRepository`，语义已通用。
> - **导出译文按实体寻址而非内容哈希**：导出/移动端的 `translations` 表用 `(entity_kind, entity_id)`（post.id/comment.id）而非 `content_hash`——移动端用现成 id 直接查，免在 RN 端重算 sha256、也免给 posts/comments 加列触发存量库 ALTER（新表 `CREATE IF NOT EXISTS` 无痛）。web 实时侧仍用 content_hash。
> - **web 未翻确认为 popover 内联确认**（非独立 AlertDialog、无实时未翻计数）：filter 式导出无逐帖选择，内联「仍要导出 / 取消」已满足「确认框」中间值；实时未翻计数留作后续增强。
> - **翻译 provider v1 仅 `claude_cli`**：`TranslationService.resolveConfig` 对非 claude_cli 抛错；MT 溢出 provider（§4.3 P2）未实现。
> - **未跑的验证**：双进程真起 claude 翻译的端到端冒烟、web 浏览器 E2E——需 worker 本机已登录 claude + 干净端口 + 外语种子数据，留作手动验证（与 [[claude-cli-provider-design]] 同口径）。
> - 源表哈希列未建二级索引（译文查询走 `translations.content_hash` 唯一索引即可，省评论批量插入的写放大）。

> 约定：每条改动后跑对应预检查（`typecheck` / 涉及 DB 跑 `test`）；按主题分组提交（Conventional Commits，中文）。
