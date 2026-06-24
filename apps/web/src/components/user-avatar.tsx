import type { CurrentUser } from '@hatch-radar/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@hatch-radar/ui/components/avatar';
import { avatarDataUri, initials } from '@/lib/avatar';

/**
 * 用户头像：有 avatar seed 则渲染 DiceBear 图，否则回退昵称首字母（靛紫底）。
 * `className` 控尺寸/圆角；`fallbackClassName` 覆盖回退块样式（如侧边栏的方角）。
 */
export function UserAvatar({
  user,
  className,
  fallbackClassName,
}: {
  user: Pick<CurrentUser, 'name' | 'avatar'>;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={className}>
      {user.avatar ? <AvatarImage src={avatarDataUri(user.avatar)} alt={user.name} /> : null}
      <AvatarFallback
        className={fallbackClassName ?? 'bg-primary/10 text-sm font-medium text-primary'}
      >
        {initials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}
