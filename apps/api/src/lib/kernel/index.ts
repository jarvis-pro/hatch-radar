/**
 * @/lib/kernel —— 框架无关的领域基座（零内部依赖）。
 *
 * 错误 / 日志 / 时间 / 加解密 / env 校验 / 网关协议(含 Dispatcher 接口)。
 * 被各能力包（db / crawler / analysis）与 api / worker 两端统一复用。
 */
export * from './errors';
export * from './logger';
export * from './env';
export * from './protocol';
export * from './utils/time';
export * from './utils/crypto';
