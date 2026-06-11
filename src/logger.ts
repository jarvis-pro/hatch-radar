import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { WriteStream } from 'node:fs';
import pino from 'pino';
import build from 'pino-pretty';

const logDir = process.env.LOG_DIR?.trim() || './logs';

const prettyOpts = {
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
  ignore: 'pid,hostname',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function openLogFile(): WriteStream {
  mkdirSync(logDir, { recursive: true });
  return createWriteStream(join(logDir, `${today()}.log`), { flags: 'a' });
}

// 当天日志文件句柄；跨天时自动关闭旧文件并打开新文件
let logDate = today();
let logFile = openLogFile();

// pump (pino-abstract-transport 内部依赖) 要求 destination 是一个完整的 Node.js 流，
// 仅有 write 方法的 plain object 缺少 .on() 等 EventEmitter 方法，会导致运行时报错。
const rollingStream = new Writable({
  write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    const now = today();
    if (now !== logDate) {
      logDate = now;
      logFile.end();
      logFile = openLogFile();
    }
    logFile.write(chunk, cb);
  },
});

/**
 * 全局 logger 实例，双路输出：
 * - 终端：pino-pretty 彩色可读格式（worker 线程）
 * - 文件：pino-pretty 无色格式 → 自定义按天滚动写入，命名格式 {logDir}/YYYY-MM-DD.log
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
