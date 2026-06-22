import type { ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';

/**
 * Lumen —— AI 产品灵感雷达（概念体验 App）。
 * 纯前端 / 纯 mock：无任何网络请求、无原生数据模块（不挂 sqlite/secure-store/camera）。
 * 主打玻璃拟态视觉 + Reanimated 重动效；同时开 web bundler 以便浏览器演示。
 */
const config: ExpoConfig = {
  name: IS_DEV ? 'Lumen Dev' : 'Lumen',
  slug: 'lumen-concept',
  version: '0.1.0',
  scheme: IS_DEV ? 'lumen-dev' : 'lumen',
  orientation: 'portrait',
  icon: './assets/icon.png',
  // 深色优先：玻璃拟态在近黑底 + 极光背景下质感最佳
  userInterfaceStyle: 'automatic',
  backgroundColor: '#0B0C12',
  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '16.4',
        },
      },
    ],
    './plugins/withExpoImportAccessLevel',
  ],
  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_DEV ? 'com.anonymous.lumen-concept.dev' : 'com.anonymous.lumen-concept',
  },
  android: {
    package: IS_DEV ? 'com.anonymous.lumenconcept.dev' : 'com.anonymous.lumenconcept',
    adaptiveIcon: {
      backgroundColor: '#0B0C12',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    bundler: 'metro',
    favicon: './assets/favicon.png',
  },
};

export default config;
