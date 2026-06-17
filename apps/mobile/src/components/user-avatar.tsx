import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { CurrentUser } from '@hatch-radar/shared';
import { Text } from '@/components/ui/text';
import { avatarSvg, initials } from '@/lib/avatar';
import { cn } from '@/lib/utils';

/**
 * 用户头像：有 seed 则渲染 DiceBear SVG，否则回退姓名首字母（靛紫底）。
 * 方圆角（rounded-md）与 web 侧栏 / 资料页对齐。
 */
export function UserAvatar({
  user,
  size = 40,
  className,
}: {
  user: Pick<CurrentUser, 'name' | 'avatar'>;
  size?: number;
  className?: string;
}) {
  return (
    <View
      className={cn('overflow-hidden rounded-md bg-primary/10', className)}
      style={{ width: size, height: size }}
    >
      {user.avatar ? (
        <SvgXml xml={avatarSvg(user.avatar)} width={size} height={size} />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Text className="font-sans-md text-primary" style={{ fontSize: Math.round(size * 0.4) }}>
            {initials(user.name)}
          </Text>
        </View>
      )}
    </View>
  );
}
