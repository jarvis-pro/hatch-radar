'use client';

import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme, type Theme } from '@hatch-radar/ui/components/theme-provider';
import { Button } from '@hatch-radar/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@hatch-radar/ui/components/dropdown-menu';

/** 触发器图标跟随「选中的模式」（而非实际明暗），与下拉单选项一一对应。 */
const TRIGGER_ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/**
 * 明暗主题切换按钮：浅色 / 深色 / 跟随系统（基于自带 ThemeProvider，class 策略）。
 * 触发器图标反映「当前选中模式」（跟随系统时显示显示器图标），与下拉高亮项保持一致；
 * 下拉用单选组高亮当前项。主题在 React 挂载前已由 index.html 早注入脚本置好，无水合闪烁。
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = TRIGGER_ICON[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="切换主题">
          <Icon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun />
            浅色
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon />
            深色
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor />
            跟随系统
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
