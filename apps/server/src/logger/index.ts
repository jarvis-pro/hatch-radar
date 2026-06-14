import { join } from 'node:path';
import pino from 'pino';
import build from 'pino-pretty';
import roll from 'pino-roll';

const logDir = process.env.LOG_DIR?.trim() || './logs';

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

// 按天滚动的文件流，由 pino-roll 负责（自动建目录、跨天切文件）。
// 命名格式：{logDir}/hatch-radar.YYYY-MM-DD.<n>.log（<n> 为当天的滚动序号）。
const rollingStream = await roll({
  file: join(logDir, 'hatch-radar'),
  frequency: 'daily',
  dateFormat: 'yyyy-MM-dd',
  mkdir: true,
});

/**
 * 全局 logger 实例，双路输出：
 * - 终端：pino-pretty 彩色可读格式（默认写 stdout）
 * - 文件：pino-pretty 无色格式 → pino-roll 按天滚动写入，命名 {logDir}/hatch-radar.YYYY-MM-DD.n.log
 *
 * 两路都用 pino-pretty 的 build() 直出（主线程），不走 pino.transport 的 worker 线程：
 * worker 线程通过 postMessage 传递 options，会对其做 structured-clone，而 messageFormat
 * 是函数无法克隆，必然抛 DataCloneError。主线程直出即可保留函数形式的 messageFormat。
 *
 * 日志目录可通过 LOG_DIR 环境变量覆盖，默认 ./logs。
 */
export const logger = pino(
  { level: 'info' },
  pino.multistream([
    {
      level: 'info',
      // 不指定 destination 时 pino-pretty 默认写 fd 1（stdout）。
      stream: build({ ...prettyOpts, colorize: true }),
    },
    {
      level: 'info',
      stream: build({ ...prettyOpts, colorize: false, destination: rollingStream }),
    },
  ]),
);
