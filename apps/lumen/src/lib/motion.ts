/**
 * 全 App 共享的动效物理 —— 统一手感是高级感的来源。所有 withSpring/withTiming
 * 都从这里取配置，避免各处弹簧参数各异导致的「廉价感」。
 */
import { Easing } from 'react-native-reanimated';

/** 标准弹簧：按压、入场、归位。干脆利落、几乎不过冲。 */
export const SPRING = { damping: 16, stiffness: 220, mass: 0.7 } as const;

/** 柔性弹簧：大位移、面板滑入。更顺滑、轻微跟随。 */
export const SPRING_SOFT = { damping: 22, stiffness: 130, mass: 0.9 } as const;

/** 弹性弹簧：收藏成功、点赞等需要一点「回弹喜悦」的反馈。 */
export const SPRING_BOUNCY = { damping: 10, stiffness: 170, mass: 0.7 } as const;

/** 时长档位（ms）。 */
export const DUR = { fast: 180, base: 380, slow: 720, count: 1200 } as const;

/** 入场缓动（easeOutCubic 的 reanimated 版）。 */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** 强调进出缓动。 */
export const EASE_IN_OUT = Easing.inOut(Easing.cubic);

/** 环境循环（极光漂移、扫掠）缓动 —— 正弦往复最自然。 */
export const EASE_SINE = Easing.inOut(Easing.sin);
