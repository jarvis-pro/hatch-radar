import { BadRequestException } from '@nestjs/common';
import { createZodValidationPipe } from 'nestjs-zod';
import type { ZodError } from 'zod';

/** zod 错误 → 「请求非法：字段 原因; …」人类可读消息（全 issue 拼接，根级记 (root)）——入参校验统一格式。 */
export function zodIssuesMessage(error: ZodError): string {
  const msg = error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ');

  return `请求非法：${msg}`;
}

/**
 * 全局 zod 校验管道（nestjs-zod）：对参数类型为 createZodDto 生成的 DTO 类按其 schema 校验入参，
 * 非 DTO 类参数（`@Param` 原始量 / `@AuthUser` 等）原样放行。错误消息工厂复用 `zodIssuesMessage`
 * （「请求非法：…」，经全局异常过滤器归一为 `{ error }`），使全仓控制器入参 400 格式统一。
 */
export const ZodDtoValidationPipe = createZodValidationPipe({
  createValidationException: (error) => new BadRequestException(zodIssuesMessage(error as ZodError)),
});
