import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** AdminController（/api/admin/*）入参校验 schema（zod）+ 推导 DTO 类型。字段 `.describe()` 同步进 Swagger。 */

/** 账户角色：普通管理员 / 超级管理员（超管不可被普通管理员创建或越权操作）。 */
const roleEnum = z.enum(['admin', 'super_admin']);

/** 新建账户入参：身份 + 初始口令 + 角色 + 能力清单。 */
export const createUserSchema = z.object({
  email: z.string().trim().min(1).describe('登录邮箱，非空'),
  name: z.string().trim().min(1).describe('展示用昵称，非空'),
  role: roleEnum.optional().describe('角色；省略服务内默认 admin'),
  password: z.string().describe('初始口令明文'),
  requireChange: z.boolean().optional().describe('是否强制首次登录改密；省略=false'),
  perms: z.array(z.string()).optional().describe('勾选的能力 key 列表（RBAC）；省略=无额外能力'),
});
export class CreateUserDto extends createZodDto(createUserSchema) {}

/** 编辑账户入参：改昵称 / 角色 / 能力（不含口令、状态——各有独立端点）。 */
export const editUserSchema = z.object({
  name: z.string().trim().min(1).describe('改展示昵称，非空'),
  role: roleEnum.optional().describe('改角色；省略服务内默认 admin'),
  perms: z.array(z.string()).optional().describe('改能力 key 列表（整体覆盖）；省略=清空额外能力'),
});
export class EditUserDto extends createZodDto(editUserSchema) {}

/** 启停账户入参。 */
export const statusSchema = z.object({
  status: z
    .enum(['active', 'disabled'])
    .describe('目标状态：active 启用 / disabled 停用（停用即吊销其会话）'),
});
export class StatusDto extends createZodDto(statusSchema) {}
