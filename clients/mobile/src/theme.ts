import { useColorScheme } from 'react-native';

const gray = {
  0: '#ffffff',
  10: '#f8f8f8',
  15: '#f1f1f1',
  20: '#eaeaea',
  25: '#e0e0e0',
  30: '#d6d6d6',
  40: '#bfbfbf',
  50: '#a4a4a4',
  60: '#868686',
  70: '#676767',
  80: '#464646',
  85: '#353535',
  90: '#242424',
};
const pink = {
  10: '#ffe8ec',
  20: '#ffd0d9',
  30: '#ffbcca',
  brand: '#ff91ac',
  70: '#87003c',
  80: '#5a0026',
};
const white = '#fafafa';
const black = '#191919';

const light = {
  dark: false,
  background: white,
  surface: gray[0],
  muted: gray[15],
  inset: gray[20],
  foreground: black,
  secondary: gray[80],
  mutedForeground: gray[70],
  placeholder: gray[50],
  border: gray[25],
  input: gray[30],
  accent: pink[70],
  link: '#406fcb',
  accentSoft: pink[10],
  primary: pink.brand,
  primaryPressed: pink[30],
  primaryForeground: black,
  control: gray[15],
  controlActive: gray[20],
  error: '#a52842',
  errorSoft: '#fff0f2',
  mark: black,
  shadow: black,
};

const dark: typeof light = {
  dark: true,
  background: black,
  surface: gray[90],
  muted: gray[90],
  inset: gray[85],
  foreground: white,
  secondary: gray[30],
  mutedForeground: gray[40],
  placeholder: gray[60],
  border: gray[85],
  input: gray[80],
  accent: pink.brand,
  link: '#87a4de',
  accentSoft: pink[80],
  primary: pink.brand,
  primaryPressed: pink[30],
  primaryForeground: black,
  control: 'rgba(250,250,250,0.12)',
  controlActive: 'rgba(250,250,250,0.16)',
  error: '#ffacb9',
  errorSoft: '#3d252e',
  mark: white,
  shadow: '#000000',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const font = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
};

export const radius = { control: 8, input: 12, card: 12, bubble: 16, composer: 24, full: 999 };
