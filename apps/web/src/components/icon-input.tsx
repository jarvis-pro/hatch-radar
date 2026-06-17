import { useState } from 'react';
import { Eye, EyeOff, Lock, type LucideIcon } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import { cn } from '@hatch-radar/ui/lib/utils';

/** 带框内左图标的输入框；`rightSlot` 可放右侧操作（如密码明/密切换）。 */
export function IconInput({
  icon: Icon,
  className,
  rightSlot,
  disabled,
  ...props
}: React.ComponentProps<'input'> & { icon: LucideIcon; rightSlot?: React.ReactNode }) {
  return (
    <div className="relative">
      <Icon
        className={cn(
          'pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground',
          disabled && 'opacity-50',
        )}
      />
      <Input
        className={cn('pl-9', rightSlot && 'pr-10', className)}
        disabled={disabled}
        {...props}
      />
      {rightSlot ? (
        <div className="absolute top-1/2 right-0.5 -translate-y-1/2">{rightSlot}</div>
      ) : null}
    </div>
  );
}

/** 密码输入框：左 Lock 图标 + 右侧明/密切换按钮（默认密文）。 */
export function PasswordInput({
  icon = Lock,
  ...props
}: Omit<React.ComponentProps<typeof IconInput>, 'type' | 'rightSlot' | 'icon'> & {
  icon?: LucideIcon;
}) {
  const [show, setShow] = useState(false);
  return (
    <IconInput
      icon={icon}
      type={show ? 'text' : 'password'}
      rightSlot={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          tabIndex={-1}
          className="text-muted-foreground hover:bg-transparent hover:text-foreground"
          aria-label={show ? '隐藏密码' : '显示密码'}
          onClick={() => setShow((s) => !s)}
        >
          {show ? <EyeOff /> : <Eye />}
        </Button>
      }
      {...props}
    />
  );
}
