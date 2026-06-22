const { withAppDelegate } = require('expo/config-plugins');

/**
 * Pin AppDelegate's `import Expo` to an explicit `public` access level.
 *
 * Two problems combine on Swift 6.2 (Xcode 26+), and `public import` is the
 * one access level that resolves both:
 *
 *  1. expo-modules-autolinking generates `internal import Expo` in
 *     ExpoModulesProvider.swift, so AppDelegate's plain `import Expo`
 *     (implicit access level) is rejected as ambiguous:
 *       "ambiguous implicit access level for import of 'Expo';
 *        it is imported as 'internal' elsewhere"
 *     -> needs an EXPLICIT level.
 *
 *  2. AppDelegate is `public class AppDelegate: ExpoAppDelegate`, so the Expo
 *     import must be `public` — an `internal import` makes the superclass
 *     internal and triggers:
 *       "class cannot be declared public because its superclass is internal"
 *     -> the explicit level must be PUBLIC, not internal.
 *
 * The regex is idempotent and also repairs a stray `internal import Expo`.
 */
module.exports = function withExpoImportAccessLevel(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language === 'swift') {
      config.modResults.contents = config.modResults.contents.replace(
        /^(?:internal |public )?import Expo$/m,
        'public import Expo',
      );
    }
    return config;
  });
};
