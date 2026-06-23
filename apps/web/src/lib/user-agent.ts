/**
 * 把会话的原始 User-Agent 串解析成「浏览器 · 系统」可读标签 + 设备类型，
 * 仅服务于会话列表的展示（粗粒度匹配，够用即可，不追求覆盖所有 UA）。
 */

export type DeviceKind = 'desktop' | 'mobile' | 'cli' | 'unknown';

export interface ParsedUA {
  /** 展示用标签，如「Chrome · macOS」「curl」「未知设备」。 */
  label: string;
  kind: DeviceKind;
}

/** 命令行 / 脚本类客户端（取其名，不含系统）。 */
const CLI_RE =
  /^(curl|Wget|HTTPie|PostmanRuntime|python-requests|Go-http-client|node-fetch|axios|Insomnia|okhttp)/i;

/** 操作系统：mobile 标记用于选移动端图标。顺序敏感（移动端先于桌面端）。 */
function detectOs(ua: string): { name: string; mobile: boolean } | null {
  if (/iPhone|iPad|iPod/.test(ua)) {
    return { name: 'iOS', mobile: true };
  }
  if (/Android/.test(ua)) {
    return { name: 'Android', mobile: true };
  }
  if (/Windows NT/.test(ua)) {
    return { name: 'Windows', mobile: false };
  }
  if (/Mac OS X|Macintosh/.test(ua)) {
    return { name: 'macOS', mobile: false };
  }
  if (/Linux|X11/.test(ua)) {
    return { name: 'Linux', mobile: false };
  }
  return null;
}

/** 浏览器 / 应用：顺序敏感（Claude/Edge 的 UA 都含 Chrome，须先判）。 */
function detectBrowser(ua: string): string {
  if (/Claude\//.test(ua)) {
    return 'Claude 桌面端';
  }
  if (/Edg\//.test(ua)) {
    return 'Edge';
  }
  if (/OPR\/|Opera/.test(ua)) {
    return 'Opera';
  }
  if (/Firefox\//.test(ua)) {
    return 'Firefox';
  }
  if (/Chrome\//.test(ua)) {
    return 'Chrome';
  }
  if (/Safari\//.test(ua)) {
    return 'Safari';
  }
  return '浏览器';
}

export function parseUserAgent(ua: string | null): ParsedUA {
  if (!ua) {
    return { label: '未知设备', kind: 'unknown' };
  }

  const cli = CLI_RE.exec(ua);
  if (cli) {
    return { label: cli[1].toLowerCase(), kind: 'cli' };
  }

  const os = detectOs(ua);
  const browser = detectBrowser(ua);
  return {
    label: os ? `${browser} · ${os.name}` : browser,
    kind: os?.mobile ? 'mobile' : 'desktop',
  };
}
