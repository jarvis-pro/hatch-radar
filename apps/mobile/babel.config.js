// NativeWind 接管 JSX（className → style），reanimated/worklets 插件由 babel-preset-expo 自动注入
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
