import { Platform } from 'react-native';

export const allowIn =
  Platform.OS === 'ios'
    ? 'Allow it in Settings → Nod.'
    : 'Allow it in Android Settings → Apps → Nod.';
