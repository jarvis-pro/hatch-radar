import { z } from 'zod';

/** AccountController（/api/auth/*）入参校验 schema（zod）+ 推导 DTO 类型。字段 `.describe()` 同步进 Swagger。 */

/** 登录入参：邮箱（归一为小写）+ 明文口令（服务内比对 scrypt 哈希）。 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().describe('登录邮箱（自动去空白、转小写归一）'),
  password: z.string().describe('明文口令'),
});
export type LoginDto = z.infer<typeof loginSchema>;

/** 改密入参：旧口令 + 新口令 + 确认；三者一致性与强度在服务内校验。 */
export const changePasswordSchema = z.object({
  current: z.string().describe('当前口令（先校验本人身份再放行改密）'),
  password: z.string().describe('新口令明文'),
  confirm: z.string().describe('再次输入新口令，须与 password 完全一致'),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

/** 改资料入参：仅昵称（trim 后非空）。 */
export const profileSchema = z.object({
  name: z.string().trim().min(1).describe('展示用昵称（去空白后必填）'),
});
export type ProfileDto = z.infer<typeof profileSchema>;

/** 改头像入参：DiceBear seed 字符串，或 null 恢复昵称首字母。 */
export const avatarSchema = z.object({
  avatar: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .nullable()
    .describe('头像 seed（≤128 字符）；null=清除自定义头像、回落昵称首字母'),
});
export type AvatarDto = z.infer<typeof avatarSchema>;
