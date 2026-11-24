import { withMainApplication, type ConfigPlugin } from 'expo/config-plugins';

const imports = [
  'android.app.Activity',
  'android.os.Bundle',
  'com.facebook.react.modules.network.OkHttpClientProvider',
  'java.util.concurrent.TimeUnit',
  'okhttp3.Dispatcher',
];

const setup = `
    val networkClient by lazy {
      OkHttpClientProvider.createClientBuilder(this)
        .pingInterval(30, TimeUnit.SECONDS)
        .dispatcher(Dispatcher().apply { maxRequestsPerHost = 16 })
        .build()
    }
    OkHttpClientProvider.setOkHttpClientFactory { networkClient }
    registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) {
        networkClient.connectionPool.evictAll()
      }
      override fun onActivityCreated(activity: Activity, state: Bundle?) {}
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {}
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })`;

export const withConnectionPing: ConfigPlugin = (config) =>
  withMainApplication(config, (config) => {
    let source = config.modResults.contents;
    if (source.includes('setOkHttpClientFactory')) return config;
    if (!source.includes('super.onCreate()'))
      throw new Error('with-connection-ping: MainApplication has no super.onCreate() to follow.');
    const missing = imports.filter((name) => !source.includes(`import ${name}\n`));
    source = source.replace(
      /^import /m,
      `${missing.map((name) => `import ${name}`).join('\n')}\nimport `,
    );
    source = source.replace('super.onCreate()', `super.onCreate()${setup}`);
    config.modResults.contents = source;
    return config;
  });
