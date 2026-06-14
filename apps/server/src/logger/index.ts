import pino from 'pino';
import build from 'pino-pretty';

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL?.trim() || 'info';

const prettyOpts = {
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
  // 忽略 context，并在有值时作为前缀拼进 message，避免结构化字段单独换行（贴近 Nest 默认观感）。
  // 用函数形式：没有 context 的日志（如自己写的 logger.info）不会留下空 [] 前缀。
  ignore: 'pid,hostname,context',
  messageFormat: (log: Record<string, unknown>, messageKey: string) => {
    const msg = log[messageKey] as string;
    return log.context ? `[${log.context}] ${msg}` : msg;
  },
};

/**
 * 全局 logger 实例，按环境单路输出到 stdout：
 * - 生产（NODE_ENV=production，进程跑在 Docker 内）：结构化 JSON → stdout。
 *   不做文件落盘 / pretty——日志的持久化、轮转、保留交给 Docker 的 logging driver
 *   （见 docker-compose.yml 的 json-file max-size/max-file），将来转发 Loki/Fluentd 只改 driver 不动代码。
 * - 开发：pino-pretty 彩色可读格式 → stdout（fd 1），方便本地直接看。
 *
 * 日志级别由 LOG_LEVEL 覆盖，默认 info。logger 在 bootstrap 之前初始化，故直读 process.env（不走 AppEnv）。
 */
export const logger = isProd
  ? pino({ level })
  : pino({ level }, build({ ...prettyOpts, colorize: true }));
