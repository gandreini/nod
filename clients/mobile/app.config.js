const variants = {
  development: { name: 'Nod Dev', package: 'com.gandreini.nod.dev' },
  e2e: { name: 'Nod E2E', package: 'com.gandreini.nod.e2e', cleartext: true },
};

module.exports = ({ config }) => {
  const variant = variants[process.env.APP_VARIANT];
  if (!variant) return config;
  return {
    ...config,
    name: variant.name,
    android: { ...config.android, package: variant.package },
    plugins: [
      ...(config.plugins ?? []),
      ...(variant.cleartext
        ? [['expo-build-properties', { android: { usesCleartextTraffic: true } }]]
        : []),
    ],
  };
};
