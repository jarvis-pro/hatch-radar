import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** 单字段的 OpenAPI 类型线索（来自 zodToOpenApi 的 properties），用于把表单字符串值还原回声明类型。 */
type PropSchema = { type?: string; enum?: unknown[] };

/**
 * 按字段声明类型把「字符串值」强转回原类型——仅处理 string 值（已是其它类型说明来自 JSON、原样返回，
 * 故对正常 JSON 入参是无操作）。表单（x-www-form-urlencoded）所有标量都序列化成字符串，借此还原：
 * 数字串→number、'true'/'false'→boolean、object/array 字段填的 JSON 串→解析、空串→undefined（视作未填，
 * 交可选/默认处理）。enum 字段保持字符串（空串作未选）。无法转换则原样返回、交 zod 报真正的校验错。
 */
function coerceFormValue(value: unknown, prop: PropSchema | undefined): unknown {
  if (typeof value !== 'string' || !prop) {
    return value;
  }

  if (Array.isArray(prop.enum)) {
    return value === '' ? undefined : value;
  }

  switch (prop.type) {
    case 'integer':
    case 'number': {
      if (value.trim() === '') {
        return undefined;
      }

      const n = Number(value);

      return Number.isNaN(n) ? value : n;
    }

    case 'boolean':
      return value === 'true' ? true : value === 'false' ? false : value === '' ? undefined : value;
    case 'object':
    case 'array': {
      if (value.trim() === '') {
        return undefined;
      }

      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    default:
      return value;
  }
}

/**
 * 复用现有 zod schema 做 DTO 校验的管道（替代 nestjs-zod，零额外依赖、兼容 zod v4）。
 * 校验失败抛 BadRequestException（→ 全局异常过滤器统一格式化为 `{ error }` 400）。
 *
 * 给出 props（字段类型表）时，先按声明类型把表单提交的字符串值强转回原类型再校验——使 Swagger 可用
 * x-www-form-urlencoded 渲染逐字段输入控件（枚举下拉等），同时不改 JSON 入参语义（仅 string 值才转）。
 *
 * 用法经 `@ZodBody(schema)`（内部以 schema 派生 props 并构造本管道）。
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(
    // 待校验的 zod schema：transform 时用其 safeParse 入参
    private readonly schema: ZodType<T>,
    // 字段类型表（zodToOpenApi 的 properties）：表单字符串值据此强转；省略=不转、原样校验
    private readonly props?: Record<string, PropSchema>,
  ) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(this.coerceFormBody(value));
    if (!result.success) {
      const msg = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ');
      throw new BadRequestException(`请求非法：${msg}`);
    }

    return result.data;
  }

  /** 顶层逐字段按 props 强转表单字符串值；非对象 / 无 props 时原样返回。强转为 undefined 的键剔除（视作未填）。 */
  private coerceFormBody(value: unknown): unknown {
    if (!this.props || value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const coerced = coerceFormValue(raw, this.props[key]);
      if (coerced !== undefined) {
        out[key] = coerced;
      }
    }

    return out;
  }
}
