import { z } from 'zod';

/** AccountController（/api/auth/*）入参校验 schema（zod）+ 推导 DTO 类型。 */

/** 登录入参：邮箱（归一为小写）+ 明文口令（服务内比对 scrypt 哈希）。 */
export const loginSchema = z.object({
  /** 登录邮箱；trim 去空白、toLowerCase 归一，避免大小写 / 空格导致查不到账户 */
  email: z.string().trim().toLowerCase(),
  /** 明文口令，交服务做 scrypt 校验（不在此处限长，避免泄露口令策略） */
  password: z.string(),
});
export type LoginDto = z.infer<typeof loginSchema>;

/** 改密入参：旧口令 + 新口令 + 确认；三者一致性与强度在服务内校验。 */
export const changePasswordSchema = z.object({
  /** 当前口令，先校验本人身份再放行改密 */
  current: z.string(),
  /** 新口令明文 */
  password: z.string(),
  /** 再次输入的新口令，服务内须与 password 完全一致 */
  confirm: z.string(),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

/** 改资料入参：仅昵称（trim 后非空）。 */
export const profileSchema = z.object({
  /** 展示用昵称，去空白后必填 */
  name: z.string().trim().min(1),
});
export type ProfileDto = z.infer<typeof profileSchema>;

/** 改头像入参：DiceBear seed 字符串，或 null 恢复昵称首字母。 */
export const avatarSchema = z.object({
  /** 头像 seed（≤128 字符）；null=清除自定义头像、回落首字母 */
  avatar: z.string().trim().min(1).max(128).nullable(),
});
export type AvatarDto = z.infer<typeof avatarSchema>;
