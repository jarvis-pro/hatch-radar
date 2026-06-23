import { Text } from '@/components/ui/text';
import { View } from 'react-native';

/** 页眉：小标签（eyebrow）+ 大标题 + 可选副标题。非首页统一用它起头。 */
export function PageHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View className="px-5 pb-1 pt-2">
      {eyebrow ? (
        <Text className="mb-1 text-xs font-sans-sb uppercase tracking-[2px] text-primary">
          {eyebrow}
        </Text>
      ) : null}
      <Text className="text-[28px] font-sans-bd leading-[1.3] text-foreground">{title}</Text>
      {subtitle ? (
        <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{subtitle}</Text>
      ) : null}
    </View>
  );
}
