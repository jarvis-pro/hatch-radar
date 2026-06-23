import { Body } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

/**
 * `@ZodBody(schema)` —— `@Body(new ZodValidationPipe(schema))` 的简写：绑定整个请求体并按 zod schema 校验，
 * 校验失败抛 BadRequestException（→ 全局异常过滤器统一格式化为 400 `{ error }`）。
 *
 * DTO 类型仍由调用方按 schema 的 `z.infer` 标注（参数装饰器无法改变形参声明类型）：
 * `@ZodBody(createUserSchema) dto: CreateUserDto`。
 */
export function ZodBody(schema: ZodType): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}
