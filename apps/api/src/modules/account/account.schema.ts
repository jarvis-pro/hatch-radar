import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PERMISSION_KEYS } from '@hatch-radar/shared';

/**
 * AccountController（/api/auth/*）入参 / 出参 schema（zod，单一事实源）。
 *
 * 经 nestjs-zod 的 `createZodDto` 生成的 DTO 类一物三用：① ZodValidationPipe 校验入参、
 * ② 编译期 TS 类型（实例形状＝`z.infer`）、③ @nestjs/swagger 文档 schema（请求体 + 响应体均自动出，
 * 无需 `@ZodBody` / 手写 `@ApiResponse`）。`.meta({ id })` 让 schema 进 components.schemas 命名模型；
 * 字段 `.meta({ description, example })` 同步进 Swagger（example 供「Try it out」预填）。
 */

// ───────────────────────── 请求体 ─────────────────────────

/** 登录入参：邮箱（归一为小写）+ 明文口令（服务内比对 scrypt 哈希）。 */
export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .meta({ description: '登录邮箱（自动去空白、转小写归一）', example: 'admin@example.com' }),
    password: z.string().meta({ description: '明文口令', example: 'correct-horse-battery' }),
  })
  .meta({ id: 'LoginBody' });
export class LoginDto extends createZodDto(loginSchema) {}

/** 改密入参：旧口令 + 新口令 + 确认；三者一致性与强度在服务内校验。 */
export const changePasswordSchema = z
  .object({
    current: z.string().meta({ description: '当前口令（先校验本人身份再放行改密）' }),
    password: z.string().meta({ description: '新口令明文' }),
    confirm: z.string().meta({ description: '再次输入新口令，须与 password 完全一致' }),
  })
  .meta({ id: 'ChangePasswordBody' });
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

/** 改资料入参：仅昵称（trim 后非空）。 */
export const profileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .meta({ description: '展示用昵称（去空白后必填）', example: '阿杰' }),
  })
  .meta({ id: 'ProfileBody' });
export class ProfileDto extends createZodDto(profileSchema) {}

/** 改头像入参：DiceBear seed 字符串，或 null 恢复昵称首字母。 */
export const avatarSchema = z
  .object({
    avatar: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .nullable()
      .meta({ description: '头像 seed（≤128 字符）；null=清除自定义头像、回落昵称首字母' }),
  })
  .meta({ id: 'AvatarBody' });
export class AvatarDto extends createZodDto(avatarSchema) {}

// ───────────────────────── 响应体 ─────────────────────────

/** 当前登录用户（与 @hatch-radar/shared 的 `CurrentUser` 同形；role/status/permissions 复用同一真相源枚举）。 */
export const currentUserSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    avatar: z.string().nullable().meta({ description: '头像 seed；null=昵称首字母回退' }),
    role: z.enum(['super_admin', 'admin']),
    status: z.enum(['active', 'disabled']),
    mustChangePassword: z.boolean(),
    permissions: z.array(z.enum(PERMISSION_KEYS)),
  })
  .meta({ id: 'CurrentUser' });

/** `{ user }` 包络：session 校验的返回。 */
export const userEnvelopeSchema = z
  .object({ user: currentUserSchema })
  .meta({ id: 'UserEnvelope' });

/** `{ user, token }` 包络：登录成功后的返回（token 由客户端自行持久化）。 */
export const loginEnvelopeSchema = z
  .object({ user: currentUserSchema, token: z.string().meta({ description: '会话 token，客户端存 localStorage，后续请求经 Authorization: Bearer 头携带' }) })
  .meta({ id: 'LoginEnvelope' });

/** `{ ok: true }`：无返回体的写操作统一回执。 */
export const okSchema = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' });
