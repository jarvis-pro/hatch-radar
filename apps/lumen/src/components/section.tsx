import { Text } from '@/components/ui/text';
import { View } from 'react-native';

/** 区块标题：左标题 + 可选右侧次要说明。 */
export function SectionHeader({ title, trailing }: { title: string; trailing?: string }) {
  return (
    <View className="mb-3 mt-7 flex-row items-end justify-between px-5">
      <Text className="text-base font-sans-sb text-foreground">{title}</Text>
      {trailing ? <Text className="text-xs text-muted-foreground">{trailing}</Text> : null}
    </View>
  );
}

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
        <Text className="mb-1 text-xs font-sans-sb uppercase tracking-[2px] text-primary">{eyebrow}</Text>
      ) : null}
      <Text className="text-[28px] font-sans-bd leading-tight text-foreground">{title}</Text>
      {subtitle ? <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{subtitle}</Text> : null}
    </View>
  );
}
