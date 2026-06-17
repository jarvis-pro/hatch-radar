# Hatch Radar · Web 端设计审计（落地复盘）

> 立场：以产品经理 + 产品设计师视角，审判 `apps/web` 当前实现，对照《[web-redesign-design.md](web-redesign-design.md)》逐项核验"Signal"重设计的落地质量，标出仍存在的设计问题并给出分级优化方案。
> 范围：仅 `apps/web`（Vite + React Router SPA）+ `packages/ui` 设计令牌。不动后端契约、不动 mobile。
> 方法：通读全部 17 个页面、26 个组件、应用外壳与 `globals.css`，对照设计文档主张核验。本轮为"读代码"审计，未起真机截图。
> 日期：2026-06-17

---

## 0. 总判决

**重设计的"气质层"是成功的，但"收尾层"欠债明显，且夹带了一个会真正咬人的功能回归。**

- 文档 **P0（令牌换气质）/ P1（应用外壳）几乎完美落地**：靛紫品牌色、信号青、红/琥珀/绿强度语义、中性色微着色、Inter + JetBrains Mono、海拔阴影、雷达扫掠动效，全在 [globals.css](../packages/ui/src/styles/globals.css) 里成体系落地。登录页、数据看板两张门面页达到标杆水准。
- 问题集中在三类：
  1. **一个路由回归**让最核心的洞察页筛选/搜索/翻页/标签全部跳错页（P0）；
  2. 文档自列的 **P3/P4 大面积未兑现或只兑现空壳**（统一列表语言、Toolbar、命令面板、微交互）；
  3. 有一个**与文档主张相反的决策**——页面标题从"做大做重"反向做成了隐藏，让全站进页面没有焦点。

---

## 1. 落地记分卡

| 模块 / 页面   | 设计意图（文档）       | 状态    | 关键问题                         |
| ------------- | ---------------------- | ------- | -------------------------------- |
| 设计令牌      | 三层色彩 + 字体 + 海拔 | ✅ 落地 | 最扎实的一步                     |
| 应用外壳      | 持久侧栏 + 上下文顶栏  | ✅ 落地 | offcanvas 偏离"图标条"规格       |
| 登录页        | 接入仪式感             | ✅ 标杆 | 雷达扫掠 + 品牌区到位            |
| 数据看板      | 指挥中心               | ✅ 标杆 | 价值优先重做，全站最精致         |
| 帖子列表      | 统一数据列表语言       | ✅ 落地 | `Item` 语言，应作统一基准        |
| 洞察详情      | 阅读页                 | ✅ 良好 | 缺右侧锚点 / 重新分析入口        |
| 任务队列      | 实时队列               | ⚠️ 部分 | 缺重试/取消/迷你时间线           |
| 分析工作台    | 批量收件箱             | ⚠️ 部分 | 旧表格 + 入队静默无反馈          |
| 设置·三管理器 | 卡片化 + 二次确认      | ⚠️ 部分 | flash + `window.confirm` 旧范式  |
| 洞察列表      | 信号优先卡片           | 🐞 回归 | 卡片精致，但筛选/翻页/标签跳错页 |
| 页面标题层级  | H1 做大做重            | 🐞 反转 | H1 撤为 `sr-only`，进页面无焦点  |
| 命令面板 ⌘K   | 情报检索 + 动作        | ◐ 空壳  | 仅导航 + 主题，招牌功能未兑现    |

图例：✅ 落地到位 · ⚠️ 部分/欠债 · 🐞 缺陷/回归 · ◐ 空壳/缺失

---

## 2. 落地得好的部分（基线肯定）

- **设计令牌成体系**（[globals.css](../packages/ui/src/styles/globals.css)）：品牌靛紫与强度语义色（红/琥珀/翠）严格分工互不串台；中性色 `chroma` 对齐品牌 hue(277) 微着色，廉价灰一扫而空；`signal-pulse` / `radar-sweep` 动效带 `prefers-reduced-motion` 降级。
- **信号优先真的落到了最该落的地方**：洞察卡左侧强度色条（[insight-card.tsx](../apps/web/src/components/insight-card.tsx)）、`IntensityBadge` 语义色点（[badges.tsx](../apps/web/src/components/badges.tsx)）、看板强度横向条，一眼能读"强弱"。
- **数据看板价值优先重做**（[dashboard.tsx](../apps/web/src/pages/dashboard.tsx)）：异常告警条（仅有事才出现）→ 今日产出（带同比）→ 吞吐/成本（recharts）→ 分布 → 系统健康下沉。Worker 心跳脉冲、队列在飞数都做了"活着"的表达。
- **登录页仪式感**（[login.tsx](../apps/web/src/pages/login.tsx)）：左品牌区雷达同心环 + 扫掠光束 + "把社区噪音炼成产品信号"，完整兑现文档 §5.9。
- **帖子列表是"数据列表语言"的正确示范**（[posts.tsx](../apps/web/src/pages/posts.tsx)）：`Item`/`ItemGroup` + 响应式列折叠 + 语义徽标。
- **空/错/禁止/404 状态统一**走 `Empty` 原语（[empty.tsx](../apps/web/src/components/empty.tsx)、[forbidden.tsx](../apps/web/src/components/forbidden.tsx)、[not-found.tsx](../apps/web/src/pages/not-found.tsx)）。
- **账户/RBAC 管理器是新一代样板**（[accounts-manager.tsx](../apps/web/src/components/accounts-manager.tsx)）：`AlertDialog` 字典驱动危险确认、`DropdownMenu` 收纳行操作、护栏置灰。

---

## 3. 分级问题清单与优化方案

### P0 · 必须修：洞察页路由回归 🐞

- **现状**：`/` 已改为看板、洞察列表迁到 `/insights`（[router.tsx:30-31](../apps/web/src/router.tsx#L30)），但洞察页内部导航目标没跟着改：
  - [insights.tsx:75](../apps/web/src/pages/insights.tsx#L75) `FilterBar basePath="/"`
  - [insights.tsx:128](../apps/web/src/pages/insights.tsx#L128) `Pagination basePath="/"`
  - [insight-detail.tsx:100](../apps/web/src/pages/insight-detail.tsx#L100) 标签链接 `to={\`/?q=${tag}\`}`
- **问题**：在洞察页**选筛选 / 翻页 / 搜索 / 点详情标签**会跳到 `/`（看板），看板不读这些 query 参数 → 筛选丢失、用户以为"坏了"。对照 [posts.tsx:53](../apps/web/src/pages/posts.tsx#L53)、[queue.tsx:372](../apps/web/src/pages/queue.tsx#L372)、[admin-audit.tsx:44](../apps/web/src/pages/admin-audit.tsx#L44) 都正确——**只有洞察页错**，坐实是迁路由遗留。
- **方案**：三处 `/` → `/insights`。建议加一条守卫测试"列表页 basePath === 自身路由"。

### P1 · 高优先级

#### 1.1 反馈系统三套并存，最差的那套用在最高频的设置页

- **现状**：全局 `<Toaster/>` 已挂载（[main.tsx:28](../apps/web/src/main.tsx#L28)）、新组件已用 `toast`（[account-profile.tsx:41](../apps/web/src/pages/account-profile.tsx#L41)），但：
  - [settings-manager.tsx](../apps/web/src/components/settings-manager.tsx)：`flash` state + 小灰字；删模型/删 Key 用原生 `window.confirm`；"改 base_url 清空全部 Key"未进确认环节。
  - [sources-manager.tsx](../apps/web/src/components/sources-manager.tsx)：同病 + `⚠️` emoji + 把内部文档路径暴露给终端用户。
  - [runtime-settings-manager.tsx](../apps/web/src/components/runtime-settings-manager.tsx)：`flash`（"已保存立即生效"这类关键确认藏在小灰字里）。
- **问题**：成功提示几乎无视觉信号；`window.confirm` 不可主题化、移动端差、破坏"像系统不像页面"；重后果无确认；`flash` 非 `aria-live`，屏幕阅读器收不到结果。
- **方案**：以 [accounts-manager.tsx](../apps/web/src/components/accounts-manager.tsx) 为样板，统一到 **`toast`（瞬时反馈）+ `AlertDialog`（危险确认）**。全批性价比最高的一次性现代化。

#### 1.2 命令面板 ⌘K 是空壳

- **现状**：[command-palette.tsx](../apps/web/src/components/command-palette.tsx) 只做导航跳转 + 主题切换。
- **问题**：产品本质是"情报检索"，文档 §4.3 要它能搜任意洞察/帖子、切 active 模型、对选中帖发起分析、跳设置 Tab，并称其"专业感密度最高"。现在只能跳 8 个导航项，最该有内容的地方最空。
- **方案**：接异步搜索（防抖打 `/insights?q=` `/posts?q=` 取前若干条作为可跳转结果）+ 动作组（切 active 模型 / 跳设置 Tab）。库（cmdk）已具备，纯前端即可。

#### 1.3 四种列表范式未统一

- **现状**：洞察 = `Card`（[insight-card.tsx](../apps/web/src/components/insight-card.tsx)）、帖子 = `Item`、队列 = `Table`、分析 = `Table`。
- **问题**：文档 §1.4 把"四种列表范式打架"列为廉价感来源，§6 要"统一数据列表模式 + 密度切换"。重设计逐页打磨到位，却跳过横向统一。
- **方案**：定规则——富信息列表走 `Item`（洞察卡保留左强度色条特例），纯数据走 `Table`；补"舒适/紧凑"密度切换。

### P2 · 中优先级

#### 2.1 页面标题层级被反转（与文档主张相悖）

- **现状**：[page-header.tsx](../apps/web/src/components/page-header.tsx) 把可见 `<h1>` 撤成 `sr-only`，可见标题交给顶栏 14px 面包屑，页内唯一可见引导文案是 14px 灰色 description。
- **问题**：文档 §3.3 核心诊断正是"h1 才 18px，进页面没有焦点"，药方是**做大做重（24px/650）**；实现走到反面。账户/会话/安全页尤其塌（[account-sessions.tsx](../apps/web/src/pages/account-sessions.tsx)：面包屑 14px → 描述 14px → 区块标题 14px 三行同号堆叠）。"面包屑即标题"是合法范式，但要求内容本身有强层级来扛——看板扛得住，列表/账户页扛不住。
- **方案**：二选一——(a) 恢复真正的页面标题（20-24px/600，配面包屑做次级，**推荐**，贴合原意）；或 (b) 坚持面包屑当标题，但把每页首个区块标题提为 H2 16px/500 给出锚点。

#### 2.2 命名三处打架（SR 与可见分叉）

- **现状**：导航标签（= 可见面包屑）与 `PageHeader` sr-only h1 不一致：数据看板/看板、需求洞察/洞察、帖子库/帖子、发起分析/分析运行……7 个里 5 个对不上（[nav.ts](../apps/web/src/lib/nav.ts) vs 各页 `PageHeader title`）。
- **方案**：单一事实源——`PageHeader title` 取 `nav.ts` 的 label。

#### 2.3 FilterBar 仍"补丁感" + 错误态无重试

- **现状**：[filter-bar.tsx](../apps/web/src/components/filter-bar.tsx) 还是换行 flex 一排 select+搜索+按钮（文档 §1.4 点名要改 Toolbar + 可删 chip）；react-query 全局 `retry:false`（[main.tsx:15](../apps/web/src/main.tsx#L15)）+ [LoadError](../apps/web/src/components/empty.tsx#L38) 无重试按钮 → 网络抖一下要手刷整页。
- **方案**：FilterBar 升级 Toolbar（已选条件做可点删 chip）；`LoadError` 加"重试"按钮（传 `refetch`）。

#### 2.4 审计页过于朴素

- **现状**：[admin-audit.tsx](../apps/web/src/pages/admin-audit.tsx) 只有关键词搜索 + 裸 Table，`action` 是单色 mono badge。
- **问题**：文档 §5.8 要 action 语义色 Pill 分类 + 时间范围 + 操作者筛选 + 导出，均未做。
- **方案**：按 `action` 前缀上语义色；补时间范围 / 操作者筛选。

#### 2.5 阅读页宽度/排版不一致

- **现状**：洞察详情 `max-w-3xl`（[insight-detail.tsx:60](../apps/web/src/pages/insight-detail.tsx#L60)），帖子详情全宽（[post-detail.tsx:45](../apps/web/src/pages/post-detail.tsx#L45)）且正文塞 `bg-muted` 灰块（文档 §5.4 点名要改）。
- **方案**：帖子详情收到 `max-w-3xl`；正文去灰块、正常排版 + 行高。

### P3 · 低优先级（清理与细节）

- **`/preview-shell` 临时残留**：[dashboard.tsx:359](../apps/web/src/pages/dashboard.tsx#L359) `CostPanel` 仍 `export` 给已删除的预览路由，注释也说"截图后移除"——收回为内部函数、删注释。
- **CostPanel 注释过期**：[dashboard.tsx:355-358](../apps/web/src/pages/dashboard.tsx#L355) 说"成本折线、双轴"，实现只有 token 堆叠柱、成本仅在 tooltip——注释误导。
- **`StatCard` 的 `uppercase` 对中文无效**：[stat-card.tsx:26](../apps/web/src/components/stat-card.tsx#L26) 为英文标签设计，中文下是死代码（仅 `tracking-wide` 在加字距）。
- **侧栏折叠偏离响应式规格**：[app-sidebar.tsx:46](../apps/web/src/components/app-sidebar.tsx#L46) 用 `offcanvas`（整体滑出），文档 §4.4 要 `md` 收成 64px 图标条；`SidebarMenuButton` 的 `tooltip` 在 offcanvas 下永不触发，是死属性。
- **窄屏表格可能裁切**：账户/审计 `Table` 未包 `overflow-x-auto`（队列页有，可作样板）。
- **一次性凭据无"复制"**：重置临时密码 / 设备激活码只有 `select-all`，缺一键复制 + toast。
- **微交互欠账**：队列失败行无 `--intensity-high` 左缘标记、无重试/取消、无迷你时间线；洞察标签 `slice(0,6)` 无 `+N` 溢出提示；评论树有引导线但无折叠；分析入队无乐观反馈。

---

## 4. 建议执行顺序

1. **今天就修**：P0 路由回归（3 行，零风险）。
2. **一个 PR**：P1.1 反馈统一（`toast` + `AlertDialog` 替 `flash` / `window.confirm`）——一次性扫掉三个管理器的廉价感。
3. **一个 PR**：P2.1 / P2.2 标题层级 + 命名单源——全站"进页面有焦点"。
4. **按需**：P1.2 命令面板补检索、P1.3 列表语言统一 + 密度切换、P2.4 审计页升级。
5. **清理**：P3 随手带。

每一步都可独立交付、独立验证，不破坏后端契约。

---

## 5. 与设计文档五原则的对照

| 原则（文档 §2） | 落地度 | 说明                                |
| --------------- | ------ | ----------------------------------- |
| 像系统不像页面  | ✅     | 持久外壳 + 全幅工作区已成型         |
| 信号优先        | ✅     | 强度令牌 + 左色条贯穿列表/详情/看板 |
| 活着            | ⚠️     | 脉冲/心跳有了；乐观更新、键盘流缺席 |
| 密度有纪律      | ⚠️     | 列表语言未统一、无密度切换          |
| 克制的品牌      | ✅     | 雷达隐喻只在登录/脉搏点睛，克制得当 |
