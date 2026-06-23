import * as Crypto from 'expo-crypto';
import { createAvatar } from '@dicebear/core';
import { adventurerNeutral } from '@dicebear/collection';

/**
 * 头像固定走 DiceBear `adventurer-neutral`（CC BY 4.0，需署名，见换头像弹窗注脚）。
 * 与 web 同源同风格；库里只存所选 seed，本模块据此复算 SVG。
 * RN 用 react-native-svg 的 SvgXml 渲染，故产出 SVG 字符串（非 data URI）。
 */

/** seed → SVG 字符串缓存，避免跨组件 / 重渲染重复生成。 */
const cache = new Map<string, string>();

/** 姓名首字母（无头像时的回退）。 */
export function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

/** 由 seed 复算头像 SVG 标记（供 SvgXml）；按 seed 记忆化。 */
export function avatarSvg(seed: string): string {
  let svg = cache.get(seed);
  if (svg === undefined) {
    svg = createAvatar(adventurerNeutral, { seed }).toString();
    cache.set(seed, svg);
  }

  return svg;
}

/** 随机生成 n 个头像 seed（换头像选择器的候选批次）。 */
export function randomAvatarSeeds(n: number): string[] {
  return Array.from({ length: n }, () => Crypto.randomUUID());
}
