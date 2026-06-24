import { createAvatar } from '@dicebear/core';
import { adventurerNeutral, toonHead } from '@dicebear/collection';

/**
 * 头像统一走 DiceBear `adventurer-neutral`（CC BY 4.0，需署名，见换头像弹窗注脚）。
 * 头像由 seed 字符串确定性生成，库里只存所选 seed，本模块据此复算 SVG（data URI）。
 */

/** seed → data URI 缓存，避免跨组件 / 重渲染重复生成同一张图。 */
const cache = new Map<string, string>();

/** 昵称首字母（无头像时的回退）。 */
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

/** 评论作者头像专用缓存（与账户用户头像分开）。 */
const commentCache = new Map<string, string>();

/**
 * 评论作者（外部抓取的用户名，非系统账户）头像：DiceBear `toon-head` 风格，
 * 按用户名确定性生成并记忆化。刻意采用与账户用户不同的 DiceBear 风格（账户用
 * `adventurer-neutral`）——以风格差异区分「外部评论者」与「系统用户」，不混淆两类身份。
 */
export function commentAvatarDataUri(seed: string): string {
  let uri = commentCache.get(seed);
  if (uri === undefined) {
    uri = createAvatar(toonHead, { seed }).toDataUri();
    commentCache.set(seed, uri);
  }

  return uri;
}
