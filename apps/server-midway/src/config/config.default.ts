import { DEFAULT_HTTP_PORT } from '@hatch-radar/config';

/** HTTP 端口：读 env.HTTP_PORT（与 env.ts 同口径），缺省回落 DEFAULT_HTTP_PORT(47878)。 */
function httpPort(): number {
  const n = Number(process.env.HTTP_PORT);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_HTTP_PORT;
}

/**
 * Midway 全局配置（对应 NestJS 版 main.ts 的 setGlobalPrefix('api') + useBodyParser 5mb）。
 *
 * - koa.globalPrefix '/api'：控制器只声明子路径，外部仍为 /api/*（mobile / web 契约不变）。
 * - koa.port：绑定到 env.HTTP_PORT（默认 47878；本平替版 .env 设 47879，与 NestJS 版并排跑）。
 * - bodyParser.jsonLimit 5mb：同步推送 outbox 较大，对应 NestJS 版 useBodyParser('json',{limit:'5mb'})。
 * - midwayLogger 仅留 warn 级框架日志；业务日志统一走 pino logger（贴近 NestJS 版观感）。
 */
export default {
  // 用于 cookie 签名密钥（koa keys）；本项目会话 token 不签名，仅占位避免告警。
  keys: 'hatch-radar-midway',
  koa: {
    port: httpPort(),
    globalPrefix: '/api',
  },
  bodyParser: {
    enableTypes: ['json'],
    jsonLimit: '5mb',
  },
  midwayLogger: {
    default: {
      level: 'warn',
    },
  },
};
