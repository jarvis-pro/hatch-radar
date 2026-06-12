import type { ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';

const config: ExpoConfig = {
  name: IS_DEV ? 'Hatch Radar Dev' : 'Hatch Radar',
  slug: 'hatch-radar-mobile',
  version: '0.1.0',
  scheme: IS_DEV ? 'hatchradar-dev' : 'hatchradar',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  plugins: [
    'expo-router',
    'expo-sqlite',
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
    bundleIdentifier: IS_DEV
      ? 'com.anonymous.hatch-radar-mobile.dev'
      : 'com.anonymous.hatch-radar-mobile',
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      NSLocalNetworkUsageDescription:
        '在局域网内连接工作台拉取洞察批次（仅下行数据，无账号与追踪）。',
    },
  },
  android: {
    package: IS_DEV ? 'com.anonymous.hatchradarmobile.dev' : 'com.anonymous.hatchradarmobile',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
};

export default config;
