const { existsSync } = require('node:fs');
const { join } = require('node:path');

const variants = {
  development: { name: 'Nod Dev', package: 'com.gandreini.nod.dev' },
  e2e: { name: 'Nod E2E', package: 'com.gandreini.nod.e2e', cleartext: true },
};

module.exports = ({ config }) => {
  const variant = variants[process.env.APP_VARIANT];
  if (!variant) {
    if (!existsSync(join(__dirname, 'google-services.json'))) return config;
    return {
      ...config,
      android: { ...config.android, googleServicesFile: './google-services.json' },
      extra: { ...config.extra, push: true },
    };
  }
  return {
    ...config,
    name: variant.name,
    android: { ...config.android, package: variant.package },
    ios: {
      ...config.ios,
      bundleIdentifier: variant.package,
      ...(variant.cleartext
        ? {
            infoPlist: {
              ...config.ios?.infoPlist,
              NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
            },
          }
        : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ...(variant.cleartext
        ? [['expo-build-properties', { android: { usesCleartextTraffic: true } }]]
        : []),
    ],
  };
};
