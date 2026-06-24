import pino from 'pino';
import build from 'pino-pretty';
import { isProd, logLevel } from '@/config/env';

const level = logLevel();

const prettyOpts = {
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
  // req/res/responseTime/reqId 是 pino-http 给每条请求日志附的结构化字段——dev 下信息已并进消息行
  // （见 app.module 的 customSuccessMessage），故 pretty 模式忽略以保持单行清爽；生产（无 pretty）
  // 仍保留为 JSON 字段供检索。context 既驱动下方前缀又在此忽略，避免再以字段重复打印。
  ignore: 'pid,hostname,context,req,res,responseTime,reqId',
  messageFormat: (log: Record<string, unknown>, messageKey: string) => {
    const msg = log[messageKey] as string;

    return log.context ? `[${log.context}] ${msg}` : msg;
  },
};

/**
 * 框架无关的全局 logger（单路输出 stdout）。
 * 后端单进程全局共用；nestjs-pino 亦以本实例为底（见 main.ts），故全栈同一条 pino。
 * 级别由 LOG_LEVEL 覆盖（默认 info），生产关 pretty——均经 @/config/env 读取，不散读 process.env。
 */
export const logger = isProd()
  ? pino({ level })
  : pino({ level }, build({ ...prettyOpts, colorize: true }));
