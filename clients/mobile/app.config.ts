import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withConnectionPing } from './plugins/with-connection-ping.ts';

type Variant = { name: string; package: string; cleartext?: boolean };

const variants: Record<string, Variant> = {
  development: { name: 'Nod Dev', package: 'com.gandreini.nod.dev' },
  e2e: { name: 'Nod E2E', package: 'com.gandreini.nod.e2e', cleartext: true },
};

function variantConfig(config: ExpoConfig, variant: Variant): ExpoConfig {
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
        ? [
            ['expo-build-properties', { android: { usesCleartextTraffic: true } }] as [
              string,
              unknown,
            ],
          ]
        : []),
    ],
  };
}

function releaseConfig(config: ExpoConfig, projectRoot: string): ExpoConfig {
  if (!existsSync(join(projectRoot, 'google-services.json'))) return config;
  return {
    ...config,
    android: { ...config.android, googleServicesFile: './google-services.json' },
    extra: { ...config.extra, push: true },
  };
}

export default function appConfig({ config, projectRoot }: ConfigContext): ExpoConfig {
  const base = config as ExpoConfig;
  const variant = variants[process.env.APP_VARIANT ?? ''];
  return withConnectionPing(
    variant ? variantConfig(base, variant) : releaseConfig(base, projectRoot),
  );
}
