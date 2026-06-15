import pino from 'pino';
import build from 'pino-pretty';

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL?.trim() || 'info';

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
 * api / worker 两端共用；级别由 LOG_LEVEL 覆盖，默认 info。
 */
export const logger = isProd
  ? pino({ level })
  : pino({ level }, build({ ...prettyOpts, colorize: true }));
