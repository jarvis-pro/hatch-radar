const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// inlineRem: RNR 约定将 rem 内联为 16（移动端无根字号概念）
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
