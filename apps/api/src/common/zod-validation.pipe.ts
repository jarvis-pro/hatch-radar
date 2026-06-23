import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * 复用现有 zod schema 做 DTO 校验的管道（替代 nestjs-zod，零额外依赖、兼容 zod v4）。
 * 校验失败抛 BadRequestException（→ 全局异常过滤器统一格式化为 `{ error }` 400）。
 *
 * 用法：`@Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>`
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const msg = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ');
      throw new BadRequestException(`请求非法：${msg}`);
    }

    return result.data;
  }
}
