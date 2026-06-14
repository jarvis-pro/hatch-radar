import { join } from 'node:path';
import pino from 'pino';
import build from 'pino-pretty';
import roll from 'pino-roll';

const logDir = process.env.LOG_DIR?.trim() || './logs';

const prettyOpts = {
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
  ignore: 'pid,hostname',
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
 * - 终端：pino-pretty 彩色可读格式（worker 线程）
 * - 文件：pino-pretty 无色格式 → pino-roll 按天滚动写入，命名 {logDir}/hatch-radar.YYYY-MM-DD.n.log
 *
 * 日志目录可通过 LOG_DIR 环境变量覆盖，默认 ./logs。
 */
export const logger = pino(
  { level: 'info' },
  pino.multistream([
    {
      level: 'info',
      stream: pino.transport({
        target: 'pino-pretty',
        options: { ...prettyOpts, colorize: true },
      }),
    },
    {
      level: 'info',
      stream: build({ ...prettyOpts, colorize: false, destination: rollingStream }),
    },
  ]),
);
