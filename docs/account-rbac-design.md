# 全局账户系统与权限控制设计（Web + Mobile 同源 RBAC）

> 为 Hatch Radar 引入**一套全局账户体系**：角色分「超级管理员 / 普通管理员」，按能力逐项勾选权限。
> Web 控制台用密码登录会话；Mobile 用「管理员赋予的设备密钥凭据」激活，两端**权限同源**。
> 取代当前单一共享 `API_TOKEN` 的「局域网信任」模式。本文是落地前的设计方案。

- **状态**：设计待评审（未实现）
- **范围**：`apps/web`（登录 + RBAC + 账户/设备管理界面）、`apps/server`（Phase 2 转用户态 + 设备凭据验签）、`apps/mobile`（Phase 2 设备激活）、`packages/db`（新增表）、`packages/shared` + 新 `packages/auth`（共享能力目录与认证 crypto）
- **不在范围**：SSO / 第三方登录、2FA、被踢设备的「远程擦除本地数据」（见 §13）

> **v2 变更**：相比初版的「鉴权只在 web」，本版把账户体系**做成全局**——mobile 也用这套账户（以设备凭据形式），server 在 Phase 2 转为用户态。理由见 §3。

---

## 1. 背景与现状

- 控制台 `apps/web` 是 Next.js 16 App Router，**直连同一个 PostgreSQL 读写**（`lib/db.ts` 句柄并未设只读，README/`client.ts` 注释里「web 只读」已过时），简单 CRUD 直接落库，仅触发后台任务才 `proxyToServer` 转发给 NestJS。
- `apps/mobile` 是 Expo + 本地 SQLite 的**离线优先**伴侣 App：导入导出批次（局域网 HTTP / AirDrop）→ 全程离线人工研判 → 回局域网后经 `POST /api/sync/push` 幂等回传（按 `op_id` 去重）。当前按 `device_id` 标识，无人登录。
- 现有鉴权只有 **一个可选的共享 `API_TOKEN`**（`BearerAuthGuard`，server 与 web/mobile 同源同值），未配置时全开——即「局域网信任」。**全库无任何用户 / 角色 / 会话概念**。
- 数据层：Prisma 7 + `@prisma/adapter-pg`，schema 在 `packages/db/prisma/schema.prisma`，迁移走 CLI。约定：表名/列名 **snake_case**、模型名即表名、时间戳一律 **BigInt Unix 秒**（与 `nowSec()` 一致）。
- 已有对称加密范式：`apps/server/src/utils/crypto.ts` 用 `node:crypto` 的 `scryptSync` + AES-256-GCM 加密模型密钥。**密码哈希可直接复用 `node:crypto` scrypt，设备验签用 Ed25519，均无需引入原生依赖。**

### 目标

1. 登录/激活后才能用控制台与移动端；账户分 **超级管理员** 与 **普通管理员** 两级。
2. 超管按能力**逐项勾选**普通管理员的权限；权限在**服务端**被真正强制（web 与 server 两端）。
3. **一套账户跨端同源**：mobile 设备绑定到某个 user，权限随号、改号即时生效、停号即全灭。
4. 管理员可**远程强踢**单台设备（吊销其凭据），不影响该号其他设备。
5. 关键/计费操作有审计可查；不让 server「裸跑」。

---

## 2. 核心设计决策摘要

| #   | 决策        | 取值                                                                                                                                | 来源                                |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| D1  | 权限粒度    | 两系统角色 + **按能力逐项勾选**（per-user capability grant）                                                                        | 用户拍板                            |
| D2  | 账户范围    | **全局一套账户**：web（cookie 会话）+ mobile（设备凭据），server Phase 2 转用户态                                                   | 用户拍板（v2 反转初版「web-only」） |
| D3  | 首个超管    | **环境变量播种 + 首登强制改密**                                                                                                     | 用户拍板                            |
| D4  | 登录标识    | **邮箱 + 密码**（归一小写）；mobile 不用密码、用设备激活                                                                            | 默认（可改用户名）                  |
| D5  | 密码哈希    | **`node:crypto` scrypt**（每用户随机盐 + `timingSafeEqual`）                                                                        | 默认，复用现有范式                  |
| D6  | Web 会话    | **DB 持久化、可吊销**；cookie 存不透明 token，库存其 sha256                                                                         | 默认                                |
| D7  | 审计        | 新增 `audit_logs`：登录/账户/权限/密钥/分析/导出/设备 变更                                                                          | 默认                                |
| D8  | 建库        | **增量迁移**，纯追加表，无需清库                                                                                                    | 默认                                |
| D9  | Mobile 凭据 | **设备密钥对（Ed25519）+ 挑战-应答**；私钥不离设备，无可重放秘密上线                                                                | 用户拍板                            |
| D10 | 强踢范围    | **拒绝后续访问即可**（不远程擦除本地数据）                                                                                          | 用户拍板                            |
| D11 | 离线宽限    | 设备凭据 **sliding idle 过期**（全局默认 **30 天** + 每设备可覆盖 7/30/60），sync 滑动续期；**过期≠丢数据**（卫生兜底，非主安全闸） | 用户拍板 + 推荐                     |
| D12 | 落地节奏    | **分两期**：Phase 1 web RBAC（自洽、紧急）；Phase 2 全局 + mobile                                                                   | 推荐                                |

---

## 3. 信任平面（v2）

mobile 从「机器/设备平面」**毕业进入账户平面**——它不再共用一把令牌，而是「绑定到某个 user 的可吊销设备凭据」。残留的机器平面只剩进程间调用。

| 平面                 | 主体                     | 凭据                                      | 鉴权点                              | 解决                                 |
| -------------------- | ------------------------ | ----------------------------------------- | ----------------------------------- | ------------------------------------ |
| **账户平面（RBAC）** | web 操作者 + mobile 设备 | web=cookie 会话；mobile=设备 Ed25519 密钥 | web 数据层 + server 用户态守卫      | 「**谁/哪台设备**能做什么」          |
| **机器平面（残留）** | web 进程、worker↔gateway | 服务令牌 `API_TOKEN`                      | server `BearerAuthGuard`（§9 收紧） | 「**哪个进程**能调 server 内部 API」 |

要点：

- **一套 `users` + 一套权限目录是唯一真相源。** 设备不存权限，sync 时从绑定的 user **实时查**——改号权限下次 sync 立刻生效，无需重签凭据。
- mobile 不再依赖共享 `API_TOKEN`：每台设备一份**密钥对凭据**，私钥永不离设备，**可单独吊销（强踢）**。
- 「mobile 裸跑 server」在 v2 被根除：设备必须先被管理员赋予、且每次用都被服务端校验有效性。残留的 `API_TOKEN` 仅守 web→server 与 worker↔gateway 的进程间通道，仍按 §9 在非回环部署强制要求。

```
   人 ──密码登录──▶ [ apps/web ]──cookie会话──┐
                       │ 直连 PG 读写            │  账户平面 (RBAC)：一套 users + 权限
                       └─服务令牌 API_TOKEN─┐    ├──────────────────────────────────┐
                                            ▼    ▼                                   │
   mobile 设备 ──设备密钥签名(挑战-应答)──▶ [ apps/server (NestJS, Phase2 用户态) ]──┘
                                            ▲ 验签→解析 user→实时查权限→执行+审计
                                  worker↔gateway (API_TOKEN, 机器平面残留)
```

---

## 4. 角色与权限模型（D1）

### 4.1 两个系统角色

- **`super_admin`**：**隐式拥有全部能力**，不可被勾掉。可管理所有账户（含其他超管）与所有设备。系统**至少保留一个启用中的超管**（见 §4.4）。
- **`admin`**：能力**完全来自被授予的清单**（`user_permissions`）。新建时套用**命名预设**（默认「研判员」=看洞察+看帖子+研判；另备「只读观察者」「自定义空白」），授权显式可选——见附录与 §10.4。

> 不做「自定义角色」——两系统角色 + 每人能力勾选已满足诉求。将来要，可在 `user_permissions` 上叠加「角色模板」而不改核心模型（§13）。

### 4.2 能力目录（permission catalog）

能力 key 为 `资源:动作` 字符串，目录维护在 **`packages/shared`**（零依赖、RN 安全，web/server/mobile 共用——mobile 据此做 UI 显隐），**不进 DB enum**：新增能力无需迁移，取值由应用层校验。

| 能力 key          | 名称                        | 分组     | 敏感 | 新管理员默认 | 守卫的操作（web / mobile / server）       |
| ----------------- | --------------------------- | -------- | :--: | :----------: | ----------------------------------------- |
| `insights:view`   | 查看洞察                    | 数据浏览 |      |      ✅      | web `/`、`/insights/*`；mobile 浏览批次   |
| `posts:view`      | 查看帖子与评论              | 数据浏览 |      |      ✅      | web `/posts/*`                            |
| `insights:triage` | 研判（状态/评级/标签/笔记） | 研判     |      |      ✅      | web 研判控件；**mobile sync 回传 triage** |
| `analyze:run`     | 触发 AI 分析（**计费**）    | 运营操作 |  ⚠️  |              | web `/analyze`、server `/api/analysis/*`  |
| `export:run`      | 导出/拉取批次               | 运营操作 |      |              | web 导出；**mobile 拉取 `/api/export/*`** |
| `settings:manage` | 模型与密钥管理              | 系统管理 |  ⚠️  |              | web `/settings`、server `/api/settings/*` |
| `audit:view`      | 查看审计日志                | 系统管理 |  ⚠️  |              | web `/admin/audit`                        |
| `accounts:manage` | 账户/权限/设备管理          | 系统管理 |  ⚠️  |              | web `/admin/accounts`、设备赋予与强踢     |

### 4.3 授权语义

```
hasPermission(user, key):
  if user.status != active:    return false   # 停用账户一律拒绝（其设备也连带失效）
  if user.role == super_admin: return true    # 通配，忽略 user_permissions
  return key ∈ user.permissions               # 普通管理员看授予清单
```

- `super_admin` 永远 `true`，其 `user_permissions` 为空（隐式全通，不冗余）。
- 校验始终基于**服务端当次加载的用户态**（web：会话→用户；mobile：设备→用户），不信任客户端自报。

### 4.4 越权护栏（不变量）

1. **`accounts:manage` 可委派**：被授予者可管理*其他普通管理员*与其设备，但**不能碰任何 `super_admin`**，也**不能把谁升为 `super_admin`**——只有超管能造超管。
2. **不能授予自己没有的能力**（可授集合 ⊆ 自己拥有；超管不受限）。
3. **保护最后一个超管**：不能停用/删除/降级「最后一个启用中的超管」。
4. **不能停用/删除自己**。
5. 所有账户/权限/设备写操作写 `audit_logs`。

---

## 5. Web 认证与会话

### 5.1 登录（D4 / D5）

- 邮箱（归一小写）+ 密码。哈希用 `node:crypto` scrypt，每用户随机盐，入库格式自带参数：`scrypt:<N>:<r>:<p>:<saltB64>:<hashB64>`；校验用 `timingSafeEqual`。
- **统一错误文案**「邮箱或密码不正确」，不泄露哪项错/是否存在。
- **防爆破**：按 `邮箱+IP` 失败计数 + 指数退避（web 进程内 LRU + 失败写审计，不必建表）。
- 停用账户拒绝登录。

### 5.2 会话（D6）

- 登录成功 → 生成 32 字节随机 token（base64url）写 `radar_session` cookie；`sessions` 表只存 `token_hash = sha256(token)`（原始 token 仅在浏览器）。
- cookie：`HttpOnly; Secure(生产); SameSite=Lax; Path=/; Max-Age`。
- 每请求按 `token_hash` 查会话 → 校验未过期、用户 `active` → 刷新 `last_seen_at`（滑动）。空闲过期默认 7 天、绝对过期默认 30 天，可经 env 调。
- **吊销**（删行）：登出、本人改密（吊其余）、账户停用/删除、超管强制下线。

### 5.3 首个超管：env 播种 + 首登改密（D3）

- 部署设 `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD`，幂等种子脚本在 `users` 为空时建首个 `super_admin`、置 `must_change_password=true`。
- 脚本：`apps/web/scripts/seed-admin.ts`，`pnpm --filter @hatch-radar/web seed:admin`，在 `migrate deploy` 之后跑。
- `must_change_password` 用户登录后强制跳改密页，改密前不能访问其他页；管理员「重置密码」同样置此标记。

---

## 6. Mobile 设备凭据认证（D9 / D10 / D11）

原则：mobile **不做密码登录**；设备是**绑定到某个 user 的可吊销凭据**，权限 sync 时从该 user 实时查。私钥本地生成、永不外传——明文 HTTP 局域网上**无可重放秘密上线**。

### 6.1 赋予 enrollment（管理员发起）

1. 管理员在 web「账户管理 → 某用户 → 赋予设备」：填设备名、选离线宽限期（7/30/60 天）→ 生成**一次性激活码 / 二维码**（短 TTL，如 15 分钟）。
2. 现场用户在 App 输入/扫码：App **本地生成 Ed25519 密钥对**，私钥存 `expo-secure-store`、**永不外传**；提交 `{device_id, public_key, 激活码}`。
3. server 校验激活码 → 落 `device_credentials`（`active`、`expires_at = now + 窗口`、存 `public_key`、绑定 `user_id`、记 `issued_by`），激活码作废。

### 6.2 使用（每次 sync / 导入 / 连网关）

1. App → `POST /api/auth/device/challenge {device_id}` → server 回一次性 `nonce`（短 TTL、防重放）。
2. App 用私钥签 `nonce`，携 `{device_id, nonce, signature}` 换取一个**短寿命设备会话**（几分钟，覆盖本次 sync 批量调用）。
3. server：查 `device_credentials` → `active` 且未过期？→ 用存的 `public_key` 验签 → 解析 `user_id` → 查该 user **实时权限**（如 `insights:triage` / `export:run`）→ 通过则执行并把操作归属该 user（写 `audit_logs`，sync 回传记录操作者）。
4. 成功 sync 后滑动续期 `expires_at` 与 `last_seen_at`。

> 算法：设备密钥 **Ed25519**（紧凑快；`node:crypto` 原生验签，RN 用 `tweetnacl` / `expo-crypto` 生成与签名）。nonce 由服务端随机、一次性、短 TTL。

### 6.3 离线宽限（D11）

> **定义：这是设备凭据的「最长未联网（未成功 sync）时限」——一个 sliding idle 过期，不是从激活日算的固定寿命。** 它是**卫生性兜底，不是主安全闸**：真正的闸是「强踢（服务端即时吊销）」+「每次用都验签 + 查有效性」。idle 窗只兜一种窄情况——你*没*显式踢、却长期失联的设备，重现时先要管理员重赋。

- **滑动续期**：每次成功 sync 重置 `expires_at = now + 窗口`。规律联网的设备永不过期；失联超窗才过期。
- **过期 ≠ 丢数据**：本地 outbox 仍在，重赋后同一 user 的新凭据照样按 `op_id` 幂等回传；过期只是「再 sync 前需管理员重赋」这道闸——所以窗口选大选小都不致命。
- **默认放宽**：全局默认 **30 天**（存现有 `app_settings` 键值表，键如 `device_idle_days_default`），enrollment 时可按设备覆盖。`7` 属高流动/共享设备，`60` 属长期外勤。
- 离线研判全程不碰 server；超窗未联网 → 过期 → 管理员重新赋予。
- 可选（默认不开）：再叠一个「绝对寿命/强制轮换」（如每 180 天无论是否活跃都重赋）；多数内网场景不需要。

### 6.4 强踢（D10：拒绝后续访问即可）

- 管理员在「设备列表」点「踢」→ `status=revoked`。
- 设备下次 challenge/verify 即被拒，无法 sync / 导入 / 连网关。停用该 user 则其名下**所有**设备连带失效。
- **边界（明确descoped）**：不抹除设备本地已下载数据（离线够不着）；本期不做「联网自清」，将来可加（§13）。

---

## 7. 数据库设计（D8）

新增 5 张表 + 3 个 enum，**纯追加**，不动现有业务表。账户/会话/设备用 UUID 主键；`audit_logs` 用自增 Int（同 `insights`）；跨表人引用（`created_by`/`actor_id`/`issued_by`）沿用本库**软引用不建外键**，强从属（权限/会话/设备）才建级联外键。

```prisma
/// 控制台与移动端共用的账户（唯一真相源）。密码经 scrypt 派生入库。
model users {
  id                   String      @id @default(uuid())
  email                String      @unique(map: "idx_users_email")  /// 登录标识，归一小写入库
  name                 String
  password_hash        String      /// scrypt:N:r:p:saltB64:hashB64
  role                 user_role   @default(admin)   /// super_admin 隐式全通
  status               user_status @default(active)  /// disabled 即时失效（连带其设备）
  must_change_password Boolean     @default(false)
  last_login_at        BigInt?
  created_by           String?     /// 软引用 users.id；env 播种的首超管为空
  created_at           BigInt
  updated_at           BigInt

  permissions user_permissions[]
  sessions    sessions[]
  devices     device_credentials[]
}

/// 普通管理员的按能力勾选授权（super_admin 不入此表）。能力 key 目录在 packages/shared，故用 String。
model user_permissions {
  user_id    String
  permission String  /// 如 insights:triage / settings:manage
  granted_by String?
  granted_at BigInt
  user       users  @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@id([user_id, permission])
  @@index([user_id], map: "idx_perm_user")
}

/// Web 浏览器会话：cookie 存不透明 token，库存其 sha256。
model sessions {
  id           String  @id @default(uuid())
  user_id      String
  token_hash   String  @unique(map: "idx_sessions_token")  /// sha256(token)
  expires_at   BigInt
  last_seen_at BigInt
  user_agent   String?
  ip           String?
  created_at   BigInt
  user         users   @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id], map: "idx_sessions_user")
  @@index([expires_at], map: "idx_sessions_expires")
}

/// Mobile 设备凭据：绑定到某 user，存设备公钥；status=revoked 即强踢。权限不在此存，sync 时从 user 实时查。
model device_credentials {
  id           String        @id @default(uuid())
  user_id      String        /// 绑定账号；权限实时从这里查
  device_name  String        /// "现场 iPad 1"，强踢列表给人看
  public_key   String        /// 设备 Ed25519 公钥（私钥不离设备）
  status       device_status @default(active)  /// active | revoked
  expires_at   BigInt        /// now + 7/30/60 天，sync 滑动续期
  last_seen_at BigInt?
  issued_by    String?       /// 赋予它的管理员（软引用 users.id）
  created_at   BigInt
  user         users         @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id], map: "idx_devcred_user")
}

/// 审计日志：敏感与计费操作。只追加；actor 删除后保留（软引用）。
model audit_logs {
  id          Int      @id @default(autoincrement())
  actor_id    String?  /// users.id（软引用）；系统动作或已删时为空
  action      String   /// auth.login / account.create / permission.update / device.enroll / device.revoke / analyze.run / export.run ...
  target_type String?
  target_id   String?
  metadata    Json?
  ip          String?
  created_at  BigInt

  @@index([actor_id], map: "idx_audit_actor")
  @@index([created_at], map: "idx_audit_created")
}

enum user_role    { super_admin  admin }
enum user_status  { active       disabled }
enum device_status{ active       revoked }
```

> 一次性激活码可不另建表：由服务端用 `API_TOKEN`/专用密钥签发短 TTL 的一次性令牌（含 user_id + 过期 + 随机 jti），enrollment 时验签即可；如需「可撤销待激活列表」再加 `device_enrollments` 表。
>
> **迁移**：`pnpm db:migrate` 生成 `add_accounts_rbac`，与既有 `20260614120000_jobs_active_partial_unique` 并存；生成类型经 `@hatch-radar/db` 导出给 web 与 server。

---

## 8. 校验落点（纵深防御）

**前端隐藏只是 UX，服务端才是权威。**

### 8.1 Web（Phase 1）

1. **中间件 `middleware.ts`（粗筛）**：无 `radar_session` → 跳 `/login?next=`；放行 `/login`、静态资源。`must_change_password` 一律跳改密页。
2. **数据访问层（权威）**：RSC / server action / route handler 用 `requireSession()`（查 `sessions`+`users`，失效则重定向）与 `requirePermission(key)`（无权渲染 403）。
3. **每个写操作各自 `requirePermission`**，不依赖中间件或隐藏按钮。
4. **web→server 代理**：`serverApiFetch` 仍以服务身份带 `API_TOKEN`，并透传操作者（`X-Actor-User-Id`）供 server 审计。web 已校验过人，server 信任 web 这个服务。

### 8.2 Server（Phase 2 转用户态）

- 新增 `DeviceAuthGuard`：解析设备会话 → 查 `device_credentials`（active/未过期）→ 验签 → 解析 user → 加载权限。
- `sync` / `export` 等 **mobile 直连端点**改为：`DeviceAuthGuard` + 按能力校验（`insights:triage` / `export:run`），并把操作归属该 user 写审计。
- web 代理来的 `settings` / `analysis` 端点：保留 `BearerAuthGuard`（机器信任 web）+ 记录透传的 actor；不重复做人鉴权（web 已做）。
- `GET /api/health` 维持公开。

---

## 9. 机器平面收紧（§3 残留）

mobile 离开共享令牌后，`API_TOKEN` 仅剩两个用途：**web→server 代理** 与 **worker↔gateway**。仍要堵裸跑：

1. **非回环强制 `API_TOKEN`**：server 绑 `0.0.0.0` 却未设 token → 启动报错（在 `apps/server/src/config/env.ts` 加校验）。回环调试可放行。**此项与账户系统解耦，可先单独落地。**
2. web 必配同值（`webEnv()` 已有）。
3. 不信任网络上给局域网 HTTP 上 **TLS**（设备签名虽无可重放秘密，但 nonce/挑战交换与批次数据仍宜加密）。

---

## 10. 前端界面设计

沿用既有版式（顶栏 `max-w-5xl`、`@hatch-radar/ui` shadcn 组件 + 主题 token、零自定义 CSS、响应式），**仅做加法**；组件均已存在于 `packages/ui`。

### 10.1 路由 / 守卫

| 路由                                                              | 页面                           | 守卫              |
| ----------------------------------------------------------------- | ------------------------------ | ----------------- |
| `/login`                                                          | 登录                           | 公开              |
| `/account/password`                                               | 强制/主动改密                  | 登录态            |
| `/account`                                                        | 个人中心（资料/安全/我的权限） | 登录态            |
| `/`、`/posts`、`/analyze`、`/settings`、`/insights/*`、`/posts/*` | 现有页面 + 权限闸              | 见 §4.2           |
| `/admin/accounts`                                                 | 账户管理 + **设备管理**        | `accounts:manage` |
| `/admin/audit`                                                    | 审计日志                       | `audit:view`      |

### 10.2 顶栏与用户菜单（改 `layout.tsx` + `site-nav.tsx`）

导航按权限显隐；「账户/审计」收进右上用户菜单（`DropdownMenu`+`Avatar`+角色 `Badge`）。

```
┌────────────────────────────────────────────────────────────────────┐
│ ◎ Hatch Radar    洞察 帖子 分析 设置        ☾  ( A 张三 ▾ )          │
└────────────────────────────────────────────────────────────────────┘
                                              │ 张三 · super_admin │
                                              │ 个人中心 / 账户管理 │
                                              │ 审计日志 / 退出登录 │
```

### 10.3 登录 `/login`

居中 `Card` + `Form`/`Field`/`Input`/`Label`/`Button`，错误 `Alert`，提交态 `Spinner`。成功跳 `next` 或 `/`；`must_change_password` 跳改密页。

### 10.4 账户管理 `/admin/accounts`

`Table` 列账户；右上「新建管理员」开 `Sheet`；行内 `DropdownMenu`；破坏性操作 `AlertDialog` 二次确认。角色/状态 `Badge`。新建/编辑 `Sheet` 内权限区**按分组列 `Checkbox`**，编辑超管时全勾且 `disabled`。

```
账户管理                                              [ + 新建管理员 ]
┌──────────────┬───────────┬──────┬───────────┬─────────┬──────┐
│ 姓名/邮箱     │ 角色      │ 状态 │ 权限       │ 设备    │      │
├──────────────┼───────────┼──────┼───────────┼─────────┼──────┤
│ 李四 li@…     │ admin     │ 活跃 │ 查看·研判  │ 2 台 ▸  │ ⋯    │
└──────────────┴───────────┴──────┴───────────┴─────────┴──────┘
   行内 ⋯：编辑资料 / 编辑权限 / 管理设备 / 重置密码 / 启用·停用 / 删除
   护栏（§4.4）：对超管行、对自己、对最后一个超管，相应操作置灰 + Tooltip
```

### 10.5 设备管理（账户管理内，`Sheet`/子页）— **新增**

展开某用户的设备：列设备名、状态、最近活跃、到期；操作「赋予新设备」与「强踢」。

```
┌─ 李四 的设备 ───────────────────────────────────────┐
│ 现场 iPad 1   活跃   2 小时前   到期 28 天   [ 踢 ]   │
│ 备用手机      活跃   3 天前     到期 4 天    [ 踢 ]   │
│ 旧 iPad       已踢   —                                │
│                                  [ + 赋予新设备 ]    │
└──────────────────────────────────────────────────────┘
   「赋予新设备」→ 填设备名 + 选离线宽限(7/30/60) → 弹一次性二维码/激活码
   「踢」→ AlertDialog 确认 → status=revoked
```

组件：`Sheet`/`Table`/`Badge`/`Select`(宽限期)/`Dialog`(二维码,可用 `input-otp` 展示码)/`AlertDialog`/`Button`。

### 10.6 个人中心 `/account` 与 403

- `Tabs`：资料（改名）/ 安全（改密 + 活跃会话，可「登出其他会话」）/ 我的权限（只读）。
- 403：复用 `components/empty.tsx` 风格的「无权访问」。

### 10.7 Mobile 端（Phase 2，UI 细节另案）

新增**设备激活页**：输入/扫描管理员发的激活码 → 本地生成密钥对 → 激活；之后顶部显示「已激活为 李四」。sync 遇凭据失效/被踢 → 提示需重新赋予，**本地 outbox 不丢**。遵循 RNR（NativeWind）约定。

### 10.8 权限驱动 UI（强调）

导航/按钮按权限显隐仅为体验；每个被守卫的页面/动作在服务端 `requirePermission` 才是真闸，隐藏入口被直接访问照样 403。

---

## 11. 实施计划（D12 分两期）

### Phase 1 — Web RBAC（自洽、紧急，先发）

| 步骤  | 内容                                                          | 主要文件                                                                |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P1.1  | 加 5 表 3 enum，迁移 + 生成类型                               | `packages/db/prisma/schema.prisma`                                      |
| P1.2  | 能力目录与类型下沉                                            | `packages/shared/src/permissions.ts`                                    |
| P1.3  | Node-only 认证 crypto（scrypt、会话 token、Ed25519 验签备用） | 新 `packages/auth`（web+server 共用，mobile 不引）                      |
| P1.4  | 会话签发/校验、`requireSession`/`requirePermission`           | `apps/web/src/lib/auth/*`                                               |
| P1.5  | 中间件、`/login`、登出、强制改密                              | `apps/web/src/middleware.ts`、`app/login`、`app/account/password`       |
| P1.6  | 既有页/接口加权限闸；顶栏用户菜单 + 按权限显隐                | `app/layout.tsx`、`components/site-nav.tsx`、各 `page.tsx`、`app/api/*` |
| P1.7  | 账户管理 + 权限编辑器 + 护栏 + 审计                           | `app/admin/accounts/*`                                                  |
| P1.8  | 个人中心 + 会话管理                                           | `app/account/*`                                                         |
| P1.9  | 审计查看器 + 全链路写审计                                     | `app/admin/audit/*`                                                     |
| P1.10 | 种子脚本 + env + 文档                                         | `apps/web/scripts/seed-admin.ts`                                        |
| P1.11 | 机器平面：非回环强制 `API_TOKEN`                              | `apps/server/src/config/env.ts`                                         |

### Phase 2 — 全局 + Mobile

| 步骤 | 内容                                                                | 主要文件                                           |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------- |
| P2.1 | server 引 `packages/auth` + 用户/设备 repository                    | `apps/server/src/db/*`、`auth/*`                   |
| P2.2 | `POST /api/auth/device/challenge` + enrollment 端点                 | `apps/server/src/http/auth.controller.ts`          |
| P2.3 | `DeviceAuthGuard`（查凭据→验签→解析 user→权限）                     | `apps/server/src/common/device-auth.guard.ts`      |
| P2.4 | `sync`/`export` 改设备凭据鉴权 + 权限 + 归属审计                    | `apps/server/src/http/{sync,export}.controller.ts` |
| P2.5 | web 设备管理 UI（赋予/二维码/强踢）                                 | `app/admin/accounts/*`                             |
| P2.6 | mobile 激活页 + `expo-secure-store` 密钥 + 签名 sync + 失效重赋流程 | `apps/mobile/*`                                    |

### Phase 1 就为「将来全局」预埋的钩子

- 能力目录放 `packages/shared`（非 web lib）、认证 crypto 放 `packages/auth`（非埋 web）——Phase 2 server 直接复用。
- schema 一次性把 `device_credentials` 也建好（即便 Phase 1 不用），Phase 2 零迁移启用。

### 新增环境变量（web）

```env
SUPER_ADMIN_EMAIL=you@example.com
SUPER_ADMIN_PASSWORD=换成高强度随机串       # 仅 users 为空时播种，首登强制改密
# SESSION_IDLE_DAYS=7
# SESSION_ABSOLUTE_DAYS=30
```

---

## 12. 安全清单

- [x] 密码 scrypt + 随机盐 + `timingSafeEqual`；登录错误文案统一。
- [x] Web 会话 token 不透明、库存哈希、双过期、可吊销；改密/停用/删除即吊销。
- [x] **Mobile 设备私钥不离设备**；挑战-应答 + nonce 防重放，明文 LAN 无可重放秘密上线。
- [x] 设备凭据服务端可吊销（强踢即时生效）；停用 user 连带其设备失效。
- [x] 越权护栏（§4.4）；写操作服务端逐一 `requirePermission`；CSRF 靠 `SameSite=Lax` + 同源校验。
- [x] 敏感/计费/设备操作写审计，sync 归属到 user。
- [x] 机器平面非回环强制 `API_TOKEN`；建议局域网 TLS。
- [x] 密钥/哈希不入客户端 bundle（`server-only`）。
- [ ] 未来：2FA、密码复杂度策略、被踢设备联网自清、登录限流落表。

---

## 13. 取舍与未来扩展

- **不做自定义角色**：将来可加「角色模板」作勾选预设，不改 `user_permissions` 核心模型。
- **强踢不含远程擦除（D10）**：仅拒绝后续访问；将来可加「被踢设备联网时服务端回 revoked、App 自清本地 SQLite」逼近远程擦除。
- **设备激活仅管理员发起**：用户不能自助加设备（小团队下反而是更强的管控）；将来要自助可加「用户自助 + 审批」。
- **SSO / 2FA / 找回密码**：内网工具暂不需要；超管「重置密码 + 首登改密」已覆盖找回。

---

## 附：可调项的推荐取值

> 以下为推荐默认（已写入正文），你可随时改：

1. **登录标识 → 用邮箱**。天然唯一、审计可读、为将来找回/通知留路；mobile 不输密码（设备激活），故「用户名好打」的理由不成立。`name` 另存为显示名。改用户名只是把这个唯一字段换个语义，trivial。
2. **新管理员默认 → 「研判员」预设**（`insights:view` + `posts:view` + `insights:triage`）。把默认做成**命名预设**让授权显式、并为将来「角色模板」埋种：
   - 研判员（默认）= 看洞察 + 看帖子 + 研判
   - 只读观察者 = 看洞察 + 看帖子
   - 自定义（空白）= 全手勾
   - `export:run` / `analyze:run` / `settings:manage` / `audit:view` / `accounts:manage` 一律不入默认（最小权限，显式授予）。
3. **离线宽限 → 全局默认 + 每设备覆盖**（详见 §6.3）。全局默认存现成的 `app_settings` 键值表，enrollment UI 预填、可针对某台设备改大。
