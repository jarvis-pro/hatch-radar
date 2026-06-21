# 评估：是否塌掉框架无关包、全面 idiomatic NestJS

> 状态：**评估 / 待决策** · 日期：2026-06-21
> 触发：单进程归一（[single-process-consolidation-design.md](single-process-consolidation-design.md)）后复盘——`domain/` + `createCore` 桥接是否已成冗余抽象。

---

## 0. 一句话结论

**不建议做全面塌缩。** 单进程归一已经砍掉了 `domain` 设计里真正冗余的那一半（worker 的 `createWorkerCore`，已并入 `createCore`）。剩下的 `createCore` + 「类当令牌 useFactory」桥接，其存在理由**不是**多进程、**也不再是**多框架（Midway 早删），而是**把零 NestJS 耦合的 `packages/*` 接进 Nest DI** —— 这条理由单进程没有触及。塌缩的代价（把 7k 行纯逻辑耦合到 reflect-metadata、丢掉编译期分层、~70 文件 churn）大于收益（少 ~200 行桥接、更「常规」）。

---

## 1. 先厘清「domain 设计」到底由几件事撑着

`apps/api/src/domain/` + `createCore` 同时服务过 4 个目的，常被混为一谈：

| 驱动                        | 状态                | 说明                                                                    |
| --------------------------- | ------------------- | ----------------------------------------------------------------------- |
| ① 多框架（Midway A/B 对比） | ☠️ 已死             | Midway 2026-06 删除，NestJS 成唯一且长期框架。                          |
| ② 多进程共享装配            | ☠️ 已死（本次干掉） | worker 的 `createWorkerCore` 已并入 `createCore`，不再有两份平行装配。  |
| ③ 框架无关包 → Nest DI 桥接 | ✅ **仍在**         | `packages/*` 故意零 NestJS 耦合，靠 `createCore` + useFactory 接进 DI。 |
| ④ 编译期分层 + 测试 POJO    | ✅ **仍在**         | 包边界 = tsc 强制的依赖方向；测试 `new` 构造、不启 Nest。               |

① ② 是当年抽象的初衷，**都死了**。但 ③ ④ 是站得住的现役理由，**单进程没动它们**。所以「单进程让 domain 冗余了」这个直觉，只对 ② 成立，而 ② 已经被本次重构消化。

---

## 2. 事实（消费图 + 规模）

```
api      → analysis auth config crawler db kernel shared      （唯一后端 app）
web      → shared ui config                                    （纯前端）
mobile   → shared                                              （RN）
analysis → db kernel shared config
crawler  → db kernel shared config
db       → kernel shared config
auth     → config
kernel   → config
shared   → config        ui → config
```

| 分组                                         | 手写规模                                          | 消费方                            | 能否并入 api |
| -------------------------------------------- | ------------------------------------------------- | --------------------------------- | ------------ |
| **后端集群** kernel/db/crawler/analysis/auth | **~7,064 行**（db 生成的 43k Prisma client 不算） | **仅 api**（+ 包间互引 + 1 脚本） | 技术上可以   |
| **跨端包** shared(1.4k)/config(20)/ui        | —                                                 | api **+ web + mobile**            | ❌ 不行      |

→ 关键：`shared`/`config`/`ui` 有 web/mobile 消费方，**无论如何都得留**。所以 pnpm workspace、catalog、tsconfig 预设这套 monorepo 机器**一件都省不掉**——塌缩后端集群只是把 8 个包减到 3 个，省不掉「包」这个范式本身。

---

## 3. 现实选项

只有「全面塌缩后端集群」（下称**方案 A**）值得认真评估；其余是劣化。

- **方案 A**：把 kernel/db/crawler/analysis/auth（~7k 行）move 进 `apps/api/src/`，全部加 `@Injectable()`，删 `assembly.ts` + `core.module` 的 `fromCore` 桥，靠 Nest 自动注入。shared/config/ui 仍为包。
- **方案 B**（劣）：保留包目录但给包类加 `@Injectable()`。→ 既丢框架无关、又留包边界开销，两头不讨好。
- **方案 C**（劣）：保留包，但把 `createCore` 拆成各 feature module 内的 provider。→ 只是把桥挪个地方 + 把依赖图打散，不减反增理解成本。

---

## 4. 方案 A 成本 / 收益

**收益**

- 删 `assembly.ts`（~150 行）+ `fromCore` 清单（~50 行）≈ **少 200 行桥接仪式**。
- 更 idiomatic：`@Injectable()` + 自动注入，去掉「类当令牌 useFactory」这个要专门解释的技巧。
- 包数 8 → 3，少 5 套 package.json / tsconfig / build 边界。

**成本**

- **把 7k 行当前纯净的逻辑耦合到 NestJS**（reflect-metadata + 装饰器）——这是最实打实的损失：crawler/analysis/db 原本是可被任何运行时复用的能力库，塌缩后焊死在 Nest 上。
- **丢编译期分层**：现在 kernel(零依赖) ← db ← crawler/analysis 的方向由 tsc + 包边界强制，想反向/横向 import 直接编译不过；塌缩后退化为 ESLint 约定（充其量）。7k 行、分层清晰的领域，这层保险有实际价值。
- **基元依赖要造 token**：`LocalDispatcher(…, concurrency: number)`、若干吃 env 配置值的服务，自动注入认不出，得 `@Inject(自定义 token)`，反而引入新仪式。
- **~70 文件机械 churn**，且**纯结构、零行为变化**——没有「测试变绿」之外的正确性信号，DI 解析顺序 / Prisma client 注入时机这类 bug 全靠人肉兜，风险/收益比差。
- 关上「未来把 crawler/analysis 抽出去给第二个消费方（CLI / lambda / 第二服务）」这扇本来几乎免费留着的门。

> 注：`@Injectable()` 非侵入，17 个测试的 `new X(...)` 仍能跑（装饰器只是元数据），所以「测试会炸」这点**不成立**——但「纯净 POJO」的整洁会被装饰器噪声稀释。

---

## 5. 判断

桥接仪式 ~200 行、**几乎不变动**、已写进 CLAUDE.md、团队已理解；塌缩要付 7k 行耦合 + 丢分层 + 大 churn，换来的是审美层面的「更常规」。**不对称明显偏向不动。** 单进程归一的收益是实的（砍进程、−834 行、运维简化）；这一步的收益是虚的。

**会翻盘的条件**（任一成立再重估）：

1. 团队稳定引入 NestJS 背景的人，反复在「类当令牌」桥接上栽跟头；
2. web / mobile 退出本仓（`shared` 失去跨端消费方）→ monorepo 范式本身不再划算，那时连包带桥一起重想；
3. `assembly.ts` / `fromCore` 双重列表成为高频改动痛点（实际它很少动）。

---

## 6. 真要动，只有两个微优化值得（与方案 A 无关，可单独做）

1. **`auth`（143 行）并入 `kernel`**：两者都是零内部依赖的 Node 基座工具（auth = scrypt/Ed25519，kernel 已含 AES crypto），auth 仅 api 消费。并入减 1 包、近零风险。**但收益也微**——`auth` 独立能清晰标记「认证 crypto」边界，可不动。
2. **消除 `assembly` 返回对象 与 `core.module` `fromCore` 清单的双列**（唯一真实 DRY 疣）：用一个按 `keyof Core` 自动登记的 helper 取代逐条 `fromCore`。**这才是 domain 设计里当前唯一值得顺手清的点**，且不破坏框架无关边界。

> 建议：维持现状；若手痒，只做 §6.2（低风险、去掉唯一的真实重复）。
