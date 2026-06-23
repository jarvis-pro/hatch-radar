import pino from 'pino';
import build from 'pino-pretty';
import { isProd, logLevel } from '@/config/env';

const level = logLevel();

const prettyOpts = {
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
  ignore: 'pid,hostname,context',
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
