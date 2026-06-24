import { z } from 'zod';
import type { ZodType } from 'zod';
import { logger } from '@/logger';

/** zod 为 `.int()` 自动补的安全整数上下界（±2^53-1），对文档是噪声——按此哨兵值识别后剔除。 */
const SAFE_INT_MAX = 9007199254740991;

/**
 * 递归剔除整数 schema 上 zod 自动补的安全整数哨兵界（maximum=2^53-1 / minimum=-(2^53-1)），保留真实
 * 约束（如 min(1)）。原地改写传入的 schema 树（遍历嵌套 properties / items / oneOf 等所有子对象）。
 */
function pruneIntSentinels(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(pruneIntSentinels);

    return;
  }

  if (node === null || typeof node !== 'object') {
    return;
  }

  const obj = node as Record<string, unknown>;
  if (obj.type === 'integer') {
    if (obj.maximum === SAFE_INT_MAX) {
      delete obj.maximum;
    }

    if (obj.minimum === -SAFE_INT_MAX) {
      delete obj.minimum;
    }
  }

  for (const value of Object.values(obj)) {
    pruneIntSentinels(value);
  }
}

/**
 * 把 zod schema 转成 OpenAPI 3.0 schema 对象，供 Swagger 渲染请求体结构。
 *
 * - 以「输入」语义转换（`io: 'input'`）：呈现客户端实际要发送的形状——带默认值的字段视为可选、
 *   transform 前的输入类型（如 `trim()`/`toLowerCase()` 的输入仍是 string）。
 * - `reused: 'inline'` 内联复用子 schema，杜绝 `#/$defs/...` 形态的 `$ref`（Swagger UI 不解析该指针）。
 * - `target: 'openapi-3.0'`：可空字段产出 `nullable: true` 而非 `anyOf: [..., { type: 'null' }]`，契合 @nestjs/swagger v11。
 *
 * @param schema 任意 zod schema（通常是请求体的 object schema）。
 * @returns 转换后的 OpenAPI schema 对象（交 `@ApiBody({ schema })` 渲染）；当 schema 含不可表达为 JSON Schema 的构造致转换抛错时返回 null（降级：端点仍列出、仅 body 结构空缺，不致启动崩溃）。
 */
export function zodToOpenApi(schema: ZodType): Record<string, unknown> | null {
  try {
    const json = z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
      reused: 'inline',
    }) as Record<string, unknown>;
    // 顶层 $schema 元字段对 OpenAPI 文档无意义（openapi-3.0 目标通常已不含，此处防御性剔除以免污染）。
    delete json.$schema;
    pruneIntSentinels(json);

    return json;
  } catch (err) {
    logger.warn(
      `zod→OpenAPI 转换失败，对应请求体在 Swagger 中将无结构：${err instanceof Error ? err.message : String(err)}`,
    );

    return null;
  }
}
