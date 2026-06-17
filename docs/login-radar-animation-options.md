# 登录页雷达动画 —— 升级方案备选集

> 状态：选型文档（2026-06-17），供逐个评估，未实现。
> 现状文件：品牌区背景 `RadarBackdrop` 在 `apps/web/src/pages/login.tsx`，关键帧 `radar-sweep` 在 `packages/ui/src/styles/globals.css`。
> 链接核实图例：✅ = 已亲自打开并确认渲染效果；⚠️ = 链接可达但为客户端渲染 SPA / CodePen 反爬，需在浏览器再看一眼；🔒 = npm 页面对自动抓取返回 403，包名与版本经 registry API 确认，URL 为标准规范地址。

---

## 1. 背景：为什么要换

当前实现不是"雷达"，而是**一个匀速旋转的扇形**。真实/电影感雷达的质感来自四件事，现状一件都没占：

1. **没有余晖拖尾**——硬边 90° 扇形 + 线性渐变刚性旋转，读起来是"加载转圈"而非"扫描"。
2. **没有因果**（最致命）——波束扫过一堆纹丝不动的圆环，扫了等于没扫；缺"波束扫到目标→点亮→衰减"的叙事。
3. **零辉光、纯线框**——18% 描边的细线像工程草图，缺 `drop-shadow`/`box-shadow` 辉光与带光晕的锐利前缘。
4. **线性匀速、无生命**——没有呼吸感（周期性向外扩散的 sonar emit 环）。

> 结论：**第一选择不是"换炫库"，而是"把雷达做对"**。雷达隐喻与产品定位（从全网噪声里捞信号）高度契合，不该轻易丢弃。下面方案按"投入 ↔ 惊艳"分四层。

---

## 评估维度

| 维度     | 说明                                                          |
| -------- | ------------------------------------------------------------- |
| 叙事契合 | 与"信号情报 / 从噪声捞信号"隐喻的贴合度                       |
| 体积     | 对登录路由首屏的负担（登录页应轻）                            |
| 工时     | 落地与调参成本                                                |
| 维护     | 上游活跃度，决定长期风险                                      |
| 栈契合   | 与现有 React 19 + Vite + Tailwind v4 + `globals.css` 的融合度 |

---

## T0 · 自研：把现有雷达做对（推荐起点）

**是什么**：保持纯 SVG + CSS keyframes，零新依赖，补齐上面四个缺口：

- `conic-gradient` 余晖拖尾替换硬边扇形；
- 6 个回波点，每个 flare 动画 `animation-delay = 角度/360 × 周期`，波束转到哪点亮到哪（制造因果）；
- 回波 + 中心点加 `drop-shadow` 辉光，叠一道带 `box-shadow` 光晕的锐利前缘线；
- 周期性向外扩散的 sonar emit 环做呼吸感。

**契合**：叙事 ★★★★★；体积 ~0；工时 低（改 2 个文件）；维护 自有；栈契合 ★★★★★。已在对话内用同栈做过可运行 demo 验证可行（与现状用完全相同的 SVG+CSS，差距全在手法）。

**优**：最省、最 on-brand、`prefers-reduced-motion` 友好、无供应链风险。
**劣**：是 2D 精修，不是"3D 招牌级"惊艳；想要 hero 冲击力需配合 T2。

**参考链接**（从零实现技法，见文末附录 A 详列）：

- 锥形渐变扫掠教程 ✅ <https://dev.to/nikolab/animated-sonar-screen-css-only-3p9f>
- 拖尾 + 回波最接近案例（浏览器确认）<https://codepen.io/VicioBonura/pen/PwweJZR>

---

## T1 · 加动画库：motion（原 Framer Motion）

**是什么**：引入 `motion`，给回波做物理弹簧、进出场、编排（stagger），或做悬停交互。可与 T0 叠加——T0 负责视觉，motion 负责精细编排。

**契合**：叙事 ★★★★（仍是雷达）；体积 中（可 tree-shake）；工时 中；维护 ★★★★★（极活跃）；栈契合 ★★★★（React 19 就绪）。

**优**：业界最强的 React 动画编排；405 个可复制示例。
**劣**：登录页若只为一个雷达引库略重；纯 CSS 已能覆盖 T0 大部分需求。
**注**：React 19 支持据发布说明/社区一致确认（drop-in 换包 `framer-motion`→`motion`，import 改 `motion/react`）；官方 changelog 未见逐字"支持 React 19"，如在意请核 <https://motion.dev/changelog>。

**链接**

- 官网/文档 ✅ <https://motion.dev/> · React 文档 <https://motion.dev/docs/react>
- 示例（405 个，亲验）✅ <https://motion.dev/examples>
- 仓库 <https://github.com/motiondivision/motion>（旧 `framer/motion` 重定向）
- npm 🔒 `motion` <https://www.npmjs.com/package/motion>（旧 `framer-motion`），约 v12.40（2026-05）
- 维护：~32k★，极活跃；2025 年独立更名 Framer Motion → Motion。

---

## T2 · WebGL 地球：强叙事的"招牌级"惊艳

> "全球各地的信号正被探测到"——与产品（扫 Reddit/HN 全网）叙事完美咬合。**首选 cobe**（体积小到登录路由能扛），慎用纯 three.js 系（首屏阻塞）。

### T2-a · cobe（首选）

**是什么**：~5KB、零依赖的 WebGL 点阵地球，可拖拽自转，支持打 marker（信号点）。

**契合**：叙事 ★★★★★；体积 ★★★★★（~5KB）；工时 低-中；维护 ★★★★（~5.4k★，v2 约 2026-03）；栈契合 ★★★★。

**优**：体积/惊艳比无敌，登录路由完全扛得住；作者 Shu Ding（Vercel，Next.js/SWR 作者）。
**劣**：是地球不是雷达，需自己叠"信号弧线/扫描"语义；定制深度不如 r3f。
**注**：**确认在用方仅 Vercel**（vercel.com / edge，作者本人撰文证实）。Stripe/Linear 为以讹传讹，勿引用——Stripe 的地球是另一套自研 WebGL。

**链接**

- Demo + 完整 playground（亲验，含 neon/minimal 主题、marker、自转参数）✅ <https://cobe.vercel.app/>
- 仓库 ✅ <https://github.com/shuding/cobe>
- npm 🔒 `cobe` <https://www.npmjs.com/package/cobe>
- 作者撰文（替换 three.js 地球的动机）<https://shud.in/thoughts/cobe>

### T2-b · globe.gl

**是什么**：高层封装的数据可视化地球组件，开箱即用弧线（arc links）、热力、卫星、海底光缆等图层；有 React 包 `react-globe.gl`。

**契合**：叙事 ★★★★（"信号弧线从各地飞入"很贴）；体积 重（基于 three.js，~150KB+）；工时 中；维护 ★★★★（~3k★）；栈契合 ★★★（需接 three.js）。

**优**：30+ 现成示例，数据驱动弧线即"信号涌入"；GitHub-globe 同款观感。
**劣**：three.js 体积对登录页偏重，需考虑懒加载/路由分包。

**链接**

- 官网 + 示例画廊（30+，亲验）✅ <https://globe.gl/>
- 代表示例（客户端渲染）⚠️ <https://globe.gl/example/world-population/>
- 仓库 ✅ <https://github.com/vasturiano/globe.gl> · React 包 `react-globe.gl`
- npm 🔒 `globe.gl` <https://www.npmjs.com/package/globe.gl>

### T2-c · three-globe

**是什么**：globe.gl 之下的 three.js 类，纯 three.js 项目里直接用。除非你已在用 three.js，否则优先 globe.gl/cobe。

**链接**

- 仓库（即主页，无独立站）✅ <https://github.com/vasturiano/three-globe>
- 示例 ⚠️ <https://vasturiano.github.io/three-globe/example/basic/>
- npm 🔒 `three-globe` <https://www.npmjs.com/package/three-globe>
- 维护：~1.6k★，同作者，活跃。

### T2-d · react-three-fiber + drei（完全定制）

**是什么**：R3F 把 three.js 变成 React 组件，drei 是其工具集。可自己搭 3D 声呐穹顶 / 雷达罩 / 自定义着色器——天花板最高。

**契合**：叙事 ★★★★★（想做什么做什么）；体积 重；工时 **高**；维护 ★★★★★（R3F ~31k★ / drei ~9.7k★，极活跃）；栈契合 ★★★★（React 原生）。

**优**：完全可控的 3D 招牌；pmndrs 生态成熟。
**劣**：登录页背 three.js + 自研 3D，工时与体积都最贵；过度工程风险。

**链接**

- R3F 文档 ⚠️ <https://r3f.docs.pmnd.rs/> · 仓库 ✅ <https://github.com/pmndrs/react-three-fiber>
- 示例画廊（可点开互动，亲验）✅ <https://pmndrs.github.io/examples> · 精选 <https://r3f.docs.pmnd.rs/getting-started/examples>
- drei 文档 ⚠️ <https://drei.docs.pmnd.rs/> · 仓库 ✅ <https://github.com/pmndrs/drei> · Storybook（浏览器看）⚠️ <https://drei.pmnd.rs/>
- npm 🔒 `@react-three/fiber`（约 v9.6，2026-04）· `@react-three/drei`（约 v10.7，2025-11）

---

## T3 · 着色器 / 粒子：氛围背景（弱叙事）

> 漂亮但偏通用，不强化"雷达"叙事。适合放弃雷达隐喻、改走"高级氛围背景"路线时考虑。

### T3-a · Paper Shaders（`@paper-design/shaders-react`）

**是什么**：Paper 出品的零依赖 canvas 着色器库，2024 末起更新。预设含 mesh gradient、dithering、grain gradient、waves、warp、metaballs、neuro noise、god rays 等，外加图像滤镜与 Logo 动画。

**契合**：叙事 ★★（通用氛围）；体积 中；工时 低-中；维护 ★★★★（~2.2k★，2026-05 仍在推）；栈契合 ★★★★（有 React 包）。

**优**：2024-25 设计圈很火，质感高级；零依赖。
**劣**：与"雷达"无关；**仍是 0.0.x，README 警告破坏性变更走 patch 号 → 必须钉死版本**。

**链接**

- 官网 + live 画廊（每个预设可点开，亲验）✅ <https://shaders.paper.design/>
- 母产品 <https://paper.design>
- 仓库 ✅ <https://github.com/paper-design/shaders>
- npm 🔒 React `@paper-design/shaders-react` · 原生 `@paper-design/shaders`，均锁 v0.0.76（2026-04）

### T3-b · ShaderGradient（`@shadergradient/react`）

**是什么**：流动的网格渐变背景（plane/sphere/water-plane），带可视化编辑器导出配置（URL/React/Framer）。

**契合**：叙事 ★★；体积 中；工时 低；维护 ★★★（~1.7k★，2026-06 仍在推）；栈契合 ★★★★。

**优**：编辑器调好即出码，落地快；也有 Framer 插件。
**劣**：通用渐变，与产品无叙事关联。

**链接**

- 官网 ⚠️ <https://shadergradient.co>
- 编辑器/playground（建议浏览器打开，SPA 抓不到）⚠️ <https://shadergradient.co/customize>
- 仓库 ✅ <https://github.com/ruucm/shadergradient>
- npm 🔒 `@shadergradient/react`，约 v2.4.20（2025-12）

### T3-c · Vanta.js（不推荐做主视觉）

**是什么**：一行配置出动画背景（NET / GLOBE / RINGS / WAVES / FOG / TOPOLOGY / DOTS 等）。需先加载 three.js 或 p5.js。

**契合**：叙事 ★★（GLOBE/NET 略沾边）；体积 ~120KB；工时 极低；维护 ⚠️ **低活跃**；栈契合 ★★。

**优**：上手最快。
**劣**：观感偏 2019；**最后一次代码推送约 2024-03、npm 最后发布 v0.5.24 约 2022-09**——稳定但停更，做主视觉显廉价。**我会避开。**

**链接**

- 官网（首页即互动 demo，亲验可达）✅ <https://www.vantajs.com>
- 仓库 ✅ <https://github.com/tengbao/vanta> · npm 🔒 `vanta`

### T3-d · tsParticles（`@tsparticles/engine`）

**是什么**：老牌 particles.js 的 TypeScript 活跃继任者，25+ 预设（含 stars / links / matrix / fireflies / hyperspace）。"节点星座网"略沾"信号图谱"概念。

**契合**：叙事 ★★（节点网勉强沾边）；体积 中；工时 低；维护 ★★★★★（~8.9k★，**今日仍有推送**，本组最活跃）；栈契合 ★★★★（有 React 等各框架包）。

**优**：极活跃；预设多、配置友好；是 particles.js 正统继任（继承了域名 + 迁移指南）。
**劣**：与雷达叙事弱关联；粒子网做登录主视觉略"通用 SaaS"。

**链接**

- 官网 ✅ <https://particles.js.org>
- 预设/Demo 画廊（25+，亲验）✅ <https://particles.js.org/demos/>
- 仓库 ✅ <https://github.com/tsparticles/tsparticles>
- npm 🔒 引擎 `@tsparticles/engine`（v2+）/ 入口 `tsparticles`，约 v4.1.3（2026-06）

---

## 横向对比

| 方案                | 叙事契合 | 体积       | 工时  | 维护  | 栈契合 | 一句话                   |
| ------------------- | -------- | ---------- | ----- | ----- | ------ | ------------------------ |
| T0 自研做对         | ★★★★★    | ~0         | 低    | 自有  | ★★★★★  | 默认起点，最 on-brand    |
| T1 motion           | ★★★★     | 中         | 中    | ★★★★★ | ★★★★   | 精细编排，配 T0          |
| T2-a cobe           | ★★★★★    | ★★★★★(5KB) | 低-中 | ★★★★  | ★★★★   | hero 级又轻，强推备选    |
| T2-b globe.gl       | ★★★★     | 重         | 中    | ★★★★  | ★★★    | 信号弧线，但 three.js 重 |
| T2-c three-globe    | ★★★★     | 重         | 中    | ★★★★  | ★★★    | 已用 three.js 才考虑     |
| T2-d r3f+drei       | ★★★★★    | 重         | 高    | ★★★★★ | ★★★★   | 天花板最高，最贵         |
| T3-a Paper Shaders  | ★★       | 中         | 低-中 | ★★★★  | ★★★★   | 高级氛围，需钉版本       |
| T3-b ShaderGradient | ★★       | 中         | 低    | ★★★   | ★★★★   | 渐变背景，落地快         |
| T3-c Vanta.js       | ★★       | ~120KB     | 极低  | ⚠️低  | ★★     | 停更，避开               |
| T3-d tsParticles    | ★★       | 中         | 低    | ★★★★★ | ★★★★   | 最活跃，叙事偏弱         |

---

## 推荐路线（分两步，别一步上 WebGL）

1. **先做 T0**：把雷达做对（拖尾 + 回波 + 辉光 + emit 环），纯 SVG/CSS、零依赖、`prefers-reduced-motion` 友好。解决约 90% 的"劣质感"，完全 on-brand。
2. **若要 hero 级招牌**：上 **T2-a cobe**（~5KB），在地球上打 marker 表示"全球信号被探测"，叙事完美咬合且登录路由扛得住。**不建议**在登录页上 globe.gl / 纯 three.js（150KB+ 阻塞首屏不划算）。
3. **若决定放弃雷达隐喻**走纯氛围背景：T3-a Paper Shaders（质感最高，记得钉版本）或 T3-d tsParticles（最活跃）。

---

## 附录 A · T0 从零实现的参考链接

> CodePen 对自动抓取返回 403，以下渲染效果**请在浏览器各看一眼**；标 ✅ 的教程页可正常打开。

**最稳（已确认可打开的教程）**

- 锥形渐变扫掠（隐藏/显示目标 = 回波）✅ <https://dev.to/nikolab/animated-sonar-screen-css-only-3p9f> · 配套 Pen <https://codepen.io/nikolab/pen/poNEgKW>
- 雷达扫描 + 扩散涟漪环（纯 CSS）✅ <https://csswolf.com/radar-scanner-animation-effect-in-css-no-js/> · 配套 Pen <https://codepen.io/Gsbansal/pen/MWGbyrz>

**最贴目标观感（拖尾 + 回波，浏览器确认）**

- 旋转扫掠 + 磷光拖尾 + 回波，三要素最全（CSS 变量 `--trail-length` / `--blend: color-dodge` 即拖尾机制）<https://codepen.io/VicioBonura/pen/PwweJZR>

**技法参考**

- Canvas 实现（`sweepAngle`/`sweepSpeed` + HSL 渐变扫掠）<https://codepen.io/caohm/pen/qagKex>
- SVG + CSS keyframes 扫掠 <https://codepen.io/j_holtslander/pen/xYdZqq>
- canvas 回波/ping 带拖尾 <https://codepen.io/XcsN/pen/mdXOpy>
- 回波脉冲关键帧（GitHub 确认）✅ <https://gist.github.com/dgeske/5096929>

**已排除**

- React Bits（reactbits.dev）无 radar/sonar 组件，勿找。
- uiverse.io 的 radar loader 多为 spinner 伪装，未确认为真扫掠，仅作线索。
