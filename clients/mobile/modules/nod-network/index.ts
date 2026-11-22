import { requireOptionalNativeModule } from 'expo';

const native = requireOptionalNativeModule<{ reset(host: string): Promise<void> }>('NodNetwork');

export async function resetConnections(origin: string) {
  await native?.reset(new URL(origin).hostname.replace(/^\[|\]$/g, '')).catch(() => {});
}
