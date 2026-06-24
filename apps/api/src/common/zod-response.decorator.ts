import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ZodSerializerDto, createZodDto } from 'nestjs-zod';
import type { ZodDto } from 'nestjs-zod';
import type { ZodType } from 'zod';

/** 同一 schema 复用同一 ZodDto 类：免得多个端点引用同一响应 schema 时各自 createZodDto 出多个同 `.meta({ id })` 的类。 */
const dtoCache = new WeakMap<ZodType, ZodDto>();
function dtoForSchema(schema: ZodType): ZodDto {
  let dto = dtoCache.get(schema);
  if (!dto) {
    dto = createZodDto(schema);
    // createZodDto 生成匿名类，cleanupOpenApiDoc 按 class.name 命名 components（不读 schema 的 .meta id）→
    // 多个响应都落到匿名的 AugmentedZodDto 撞名、内容互相覆盖。用 schema 的 .meta({ id }) 显式命名该类。
    const id = (schema.meta() as { id?: string } | undefined)?.id;
    if (id) {
      Object.defineProperty(dto, 'name', { value: id, configurable: true });
    }

    dtoCache.set(schema, dto);
  }

  return dto;
}

/**
 * `@ZodResponse(schema, opts?)` —— 绑定响应体的「文档 + 出站序列化」，是 @ZodBody 的出参镜像。
 *
 * 同一事实源（一个 zod schema）一次满足两件事：
 * 1. 文档：由 schema 派生 OpenAPI 响应结构挂到本路由（经 @ApiResponse + createZodDto，schema 的 `.meta({ id })` 决定 components 模型名）。
 * 2. 序列化：经 nestjs-zod 的 @ZodSerializerDto + 全局 ZodSerializerInterceptor 按 schema 校验并裁剪出站响应
 *    （多余字段 strip、不符则抛序列化异常），与入参形成双向契约收口。
 *
 * 与 @ZodBody 对称：入参传 schema、出参也传 schema（内部 createZodDto，调用方无需手建 DTO 类）。
 * 须配合全局注册的 ZodSerializerInterceptor（见 AppModule），否则仅有文档、序列化不生效。
 *
 * @param schema 响应体的 zod schema（须带 `.meta({ id })` 以获得稳定的 components 模型名）。
 * @param options.status HTTP 状态码（默认 200）。
 * @param options.description 响应说明（默认空串）。
 * @param options.isArray 响应是否为该 schema 的数组（默认 false）。
 */
export function ZodResponse(
  schema: ZodType,
  options?: { status?: number; description?: string; isArray?: boolean },
): MethodDecorator {
  const { status = 200, description = '', isArray = false } = options ?? {};
  const dto = dtoForSchema(schema);

  return applyDecorators(
    ApiResponse({ status, description, type: dto, isArray }),
    ZodSerializerDto(isArray ? [dto] : dto),
  );
}
