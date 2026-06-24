import { Body } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';
import { zodToOpenApi } from './zod-to-openapi';

/** `@ApiBody({ schema })` 的 schema 入参类型（从 ApiBody 自身推导，免深路径 import SchemaObject）。 */
type ApiBodySchema = Extract<Parameters<typeof ApiBody>[0], { schema: unknown }>['schema'];

/** 单字段类型线索表（zodToOpenApi 产出的 properties），交校验管道把表单字符串值强转回声明类型。 */
type PropMap = Record<string, { type?: string; enum?: unknown[] }>;

/** 从 OpenAPI schema 取顶层 properties 作字段类型表；无 properties（非 object schema）返回 undefined。 */
function topLevelProps(openApiSchema: Record<string, unknown> | null): PropMap | undefined {
  const props = openApiSchema?.properties;

  return props && typeof props === 'object' ? (props as PropMap) : undefined;
}

/**
 * `@ZodBody(schema)` —— 绑定整个请求体、按 zod schema 校验，并以同一 schema 把请求体登记进 Swagger。
 *
 * 同一事实源（一个 zod schema）一次做完：
 * 1. 校验：等价 `@Body(new ZodValidationPipe(schema, props))`，失败抛 BadRequestException（→ 全局过滤器 400 `{ error }`）。
 * 2. 文档：把请求体声明为 `application/x-www-form-urlencoded`（`@ApiConsumes`）+ 由 schema 派生的 body 结构（`@ApiBody`）。
 *    Swagger UI 据此对 form 编码渲染**逐字段输入控件**（枚举→下拉、布尔→开关、数字→数字框），而非整块 JSON 文本框
 *    （swagger-ui / Scalar 对 application/json 一律只给 JSON 编辑器，逐字段表单仅对 form / multipart 出）。
 * 3. 还原：表单标量都以字符串提交，故把字段类型表 props 交校验管道，按声明类型把字符串强转回 number/boolean/对象等再校验
 *    （仅对 string 值生效，不改 JSON 入参语义——前端照发 JSON 仍正常）。
 *
 * DTO 类型仍由调用方按 schema 的 `z.infer` 标注（参数装饰器无法改变形参声明类型）。
 * schema 不可转 OpenAPI（个别 transform）时仅退化为纯校验、不挂文档/不强转（见 zodToOpenApi 的降级）。
 *
 * 实现：参数装饰器先做 `@Body` 绑定，再就地把 `@ApiConsumes` / `@ApiBody` 的方法级元数据写到同一方法
 * （descriptor.value）——都落在同一方法函数对象上、由 SwaggerModule 建文档时统一读取，与声明顺序无关。
 */
export function ZodBody(schema: ZodType): ParameterDecorator {
  const openApiSchema = zodToOpenApi(schema);
  const props = topLevelProps(openApiSchema);
  const bindBody = Body(new ZodValidationPipe(schema, props));
  // 边界转换：openApiSchema 是 OpenAPI schema 字面对象，结构契合 SchemaObject，但 TS 无法从
  // Record<string, unknown> 直接窄化到该接口，故经 unknown 显式断言（仅此一处的类型出入边界）。
  const methodDecorators: MethodDecorator[] = openApiSchema
    ? [
        ApiConsumes('application/x-www-form-urlencoded') as MethodDecorator,
        ApiBody({ schema: openApiSchema as unknown as ApiBodySchema }) as MethodDecorator,
      ]
    : [];

  return (target, propertyKey, parameterIndex) => {
    bindBody(target, propertyKey, parameterIndex);
    if (methodDecorators.length === 0 || propertyKey === undefined) {
      return;
    }

    // @ApiConsumes/@ApiBody 把元数据存到方法函数上（createParamDecorator/createMixedDecorator 的 descriptor 分支），故须取到方法描述符再调用。
    const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
    if (descriptor) {
      for (const decorate of methodDecorators) {
        decorate(target, propertyKey, descriptor);
      }
    }
  };
}
