---
name: add-ui
description: 给 PC 端共享 UI 库加 shadcn/ui 组件，按本仓真实结构（配置在 packages/ui，不在 apps/web）。适用场景：用户说"加个组件"、"加 shadcn"、"装个 dialog/table/sheet/select 等"、"add component"、"需要个对话框/下拉/表格"，或要在 apps/web 用一个 @hatch-radar/ui 里还没有的组件。从 packages/ui 跑 CLI，组件落 packages/ui/src/components/，零自定义 CSS、只用主题令牌、图标用 lucide。apps/mobile（RN）不适用。
user-invocable: true
---

# /add-ui — 加 shadcn 组件到共享 UI 库

给 PC 端共享库 `@hatch-radar/ui` 添加一个 shadcn/ui 组件，并在 `apps/web` 引用。

用户参数：`$ARGUMENTS`（可选，组件名，如 `dialog` / `data-table`；省略时取对话中正在讨论的组件）。

---

## 何时用 / 不用

- **用**：要在 **`apps/web`（PC 端）** 用一个 `@hatch-radar/ui` 里还没有的 shadcn 组件。
- **不用**：**`apps/mobile`**（React Native，走 React Native Reusables + 自己的 `components.json`，**勿引** `@hatch-radar/ui`）。

## 本仓真实结构（以此为准）

> CLAUDE.md 旧描述写"在 apps/web 下加"，**已过期**——apps/web 没有 `components.json`。

- shadcn 配置：**`packages/ui/components.json`**（style=`new-york`、icon=`lucide`、`cssVariables: true`）。
- 主题令牌：`packages/ui/src/styles/globals.css`（颜色只在这里的 CSS 变量）。
- 组件落点：`packages/ui/src/components/<c>.tsx`（平铺，无 `ui/` 子目录）。
- 消费：apps/web 从 `@hatch-radar/ui/components/<c>` 引。

## 流程

### 1. 查重

```bash
ls packages/ui/src/components | grep -i <c>
```

已存在就直接用，**别重装**（会覆盖本地改动）。

### 2. 跑 CLI（cwd 必须是 packages/ui）

```bash
cd packages/ui && pnpm dlx shadcn@latest add <c>
```

CLI 从 cwd 读 `components.json`——**必须在 `packages/ui` 下跑**；在 apps/web 下跑找不到配置会失败或落错地方。

### 3. 装依赖 + 引用

```bash
pnpm install                                   # shadcn 可能往 packages/ui 加 radix 等依赖
pnpm --filter @hatch-radar/web typecheck
```

apps/web 里：`import { X } from "@hatch-radar/ui/components/<c>"`。

---

## 约定

- **不写自定义 CSS**：样式走主题令牌 + Tailwind `className`，颜色用 globals.css 的 CSS 变量，**别硬编码 hex**。
- 图标只用 `lucide-react`（别引别的图标库）。
- 移动端响应式（PC 端组件也要在窄屏可用）。

## 红线

- ❌ 在 `apps/web` 下跑 `shadcn add`——没有 `components.json`。
- ❌ 写自定义 `.css` / 内联 style 堆样式——用令牌 + className。
- ❌ 在 `apps/mobile` / 任何 RN 代码引 `@hatch-radar/ui`。
- ❌ 重装已存在的组件覆盖本地改动——先查重。
