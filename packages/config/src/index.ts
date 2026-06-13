/**
 * @hatch-radar/config —— 跨端共享的运行时配置「切片」。
 *
 * 只放真正跨 app 共享、且换值会牵动多端的默认值（连接串、端口…），**零运行时依赖**。
 * 各 app 的完整 env 校验仍留在各自包里 compose 这些默认值——含密钥的配置
 * （Reddit / AI keys / SETTINGS_SECRET）绝不进本包，安全边界不被打破。
 */

// 端口刻意选 47xxx 段（IANA 基本未分配、极少与常见 dev 工具撞），后缀呼应熟悉端口便于记忆：
//   PostgreSQL 47432（…432←5432） / Server 47878（…878←旧 8787） / Web 47080（…080←:80）
// 同机多项目时不与 5432/3000/8080 等默认端口冲突。

/** 局域网导出/同步 HTTP 服务默认端口（server 绑定 / web 据此拼 SERVER_API_URL，同源避免脱节） */
export const DEFAULT_HTTP_PORT = 47878;

/** 默认 PostgreSQL 连接串（本地 docker-compose；server 读写、web 只读共用；主机映射端口 47432） */
export const DEFAULT_DATABASE_URL = 'postgres://radar:radar@localhost:47432/hatch_radar';

/** web 转发到 server 进程的默认地址（由 {@link DEFAULT_HTTP_PORT} 派生） */
export const DEFAULT_SERVER_API_URL = `http://localhost:${DEFAULT_HTTP_PORT}`;
