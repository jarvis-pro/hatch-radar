import * as Haptics from 'expo-haptics';

/** 触感反馈统一入口：模拟器/不支持的设备上静默降级 */
const safe = (p: Promise<unknown>) => {
  p.catch(() => {});
};

/** 选择类交互（筛选切换、分段控件） */
export const hapticSelect = () => safe(Haptics.selectionAsync());

/** 轻点类交互（星级评分） */
export const hapticTap = () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** 操作成功（同步/导入完成） */
export const hapticSuccess = () =>
  safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** 操作失败 */
export const hapticError = () =>
  safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
