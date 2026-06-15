import { createCustomParamDecorator, httpError, type MidwayDecoratorService } from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
import type { ZodType } from 'zod';
import type { AuthedUser } from '@/account/auth-user.decorator';
import type { DeviceUserContext } from '@/auth/device-permission.decorator';

/**
 * 自定义参数装饰器（对应 NestJS 的 @AuthUser/@DeviceUser + ZodValidationPipe + ParseIntPipe）。
 *
 * Midway 参数装饰器机制：createCustomParamDecorator(key, metadata, {impl:true,...}) 声明，
 * 运行期由 decoratorService 注册的 handler 求值（handler 收到 { metadata, originArgs }，
 * 其中 originArgs[0] 恒为 koa ctx——见 webGenerator 的 method.apply(controller,[ctx,next])）。
 * 校验类装饰器置 throwError:true，使抛出的 httpError 冒泡到全局过滤器（否则会被吞掉回落原始参数）。
 *
 * 重要：自定义参数装饰器经「异步 aspect 的 before 钩子」改写入参，故凡使用本文件装饰器的控制器方法
 * **必须声明为 async**——同步方法拿不到改写后的参数（会回落到 koa ctx）。内置 @Query/@Param 不受此限。
 */

export const AUTH_USER_KEY = 'param:auth_user';
export const DEVICE_USER_KEY = 'param:device_user';
export const VALID_BODY_KEY = 'param:valid_body';
export const VALID_QUERY_KEY = 'param:valid_query';
export const INT_PARAM_KEY = 'param:int_param';

/** 取当前登录用户（由 SessionAuthGuard 附加到 ctx.user）。 */
export function AuthUser(): ParameterDecorator {
  return createCustomParamDecorator(AUTH_USER_KEY, {}, { impl: true });
}

/** 取当前设备用户；会话通道无设备用户，返回 undefined。 */
export function DeviceUser(): ParameterDecorator {
  return createCustomParamDecorator(DEVICE_USER_KEY, {}, { impl: true });
}

/** 用 zod schema 校验请求体（对应 @Body(new ZodValidationPipe(schema))）。 */
export function ValidBody(schema: ZodType): ParameterDecorator {
  return createCustomParamDecorator(VALID_BODY_KEY, { schema }, { impl: true, throwError: true });
}

/** 用 zod schema 校验查询参数。 */
export function ValidQuery(schema: ZodType): ParameterDecorator {
  return createCustomParamDecorator(VALID_QUERY_KEY, { schema }, { impl: true, throwError: true });
}

/** 路由参数转整数（对应 @Param('id', ParseIntPipe)）；非整数 → 400。 */
export function IntParam(name: string): ParameterDecorator {
  return createCustomParamDecorator(INT_PARAM_KEY, { name }, { impl: true, throwError: true });
}

/** 参数 handler 收到的上下文（仅取用到的字段）。 */
interface ParamHandlerOptions {
  metadata: { schema?: ZodType; name?: string };
  originArgs: unknown[];
}

/** zod 校验失败 → BadRequestError（全局过滤器统一格式化为 {error} 400），消息格式与 NestJS 版一致。 */
function zodValidate(schema: ZodType, value: unknown): unknown {
  const result = schema.safeParse(value);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
      .join('; ');
    throw new httpError.BadRequestError(`请求非法：${msg}`);
  }
  return result.data;
}

/**
 * 注册全部自定义参数装饰器的 handler（在 MainConfiguration 启动时调用一次）。
 */
export function registerParams(svc: MidwayDecoratorService): void {
  svc.registerParameterHandler(AUTH_USER_KEY, (opt: ParamHandlerOptions) => {
    const ctx = opt.originArgs[0] as Context & { user?: AuthedUser };
    return ctx.user;
  });
  svc.registerParameterHandler(DEVICE_USER_KEY, (opt: ParamHandlerOptions) => {
    const ctx = opt.originArgs[0] as Context & { deviceUser?: DeviceUserContext };
    return ctx.deviceUser;
  });
  svc.registerParameterHandler(VALID_BODY_KEY, (opt: ParamHandlerOptions) => {
    const ctx = opt.originArgs[0] as Context;
    return zodValidate(opt.metadata.schema as ZodType, ctx.request.body);
  });
  svc.registerParameterHandler(VALID_QUERY_KEY, (opt: ParamHandlerOptions) => {
    const ctx = opt.originArgs[0] as Context;
    return zodValidate(opt.metadata.schema as ZodType, ctx.query);
  });
  svc.registerParameterHandler(INT_PARAM_KEY, (opt: ParamHandlerOptions) => {
    const ctx = opt.originArgs[0] as Context & { params?: Record<string, string> };
    const raw = ctx.params?.[opt.metadata.name as string];
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      throw new httpError.BadRequestError(`参数 ${opt.metadata.name} 必须是整数`);
    }
    return n;
  });
}
