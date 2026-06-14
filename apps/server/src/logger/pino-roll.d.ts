// pino-roll 未自带类型声明，这里补一份最小可用的 d.ts。
declare module 'pino-roll' {
  import type { DestinationStream } from 'pino';

  interface PinoRollOptions {
    /** 日志文件基名；滚动后命名为 file.date.count.extension */
    file: string | (() => string);
    /** 滚动频率：'daily' | 'hourly' | 间隔毫秒数 */
    frequency?: 'daily' | 'hourly' | number;
    /** 单文件大小上限（如 '10m'），可与 frequency 组合 */
    size?: number | string;
    /** 文件扩展名，默认 '.log' */
    extension?: string;
    /** 追加到文件名的日期格式（date-fns 格式，如 'yyyy-MM-dd'） */
    dateFormat?: string;
    /** 父目录不存在时自动创建 */
    mkdir?: boolean;
    /** 维护 current.log 软链指向当前活动文件 */
    symlink?: boolean;
    /** 旧文件清理策略 */
    limit?: { count?: number; removeOtherLogFiles?: boolean };
  }

  /** 创建按时间/大小自动滚动的 pino 文件流（SonicBoom）。 */
  export default function buildStream(options: PinoRollOptions): Promise<DestinationStream>;
}
