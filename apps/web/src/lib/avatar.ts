import { createAvatar } from '@dicebear/core';
import { adventurerNeutral } from '@dicebear/collection';

/**
 * 头像统一走 DiceBear `adventurer-neutral`（CC BY 4.0，需署名，见换头像弹窗注脚）。
 * 头像由 seed 字符串确定性生成，库里只存所选 seed，本模块据此复算 SVG（data URI）。
 */

/** seed → data URI 缓存，避免跨组件 / 重渲染重复生成同一张图。 */
const cache = new Map<string, string>();

/** 姓名首字母（无头像时的回退）。 */
export function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

/** 由 seed 复算头像，产出可直接用作 `<img src>` 的 data URI（按 seed 记忆化）。 */
export function avatarDataUri(seed: string): string {
  let uri = cache.get(seed);
  if (uri === undefined) {
    uri = createAvatar(adventurerNeutral, { seed }).toDataUri();
    cache.set(seed, uri);
  }
  return uri;
}

/** 随机生成 n 个头像 seed（换头像弹窗的候选批次）。 */
export function randomAvatarSeeds(n: number): string[] {
  return Array.from({ length: n }, () => crypto.randomUUID());
}
