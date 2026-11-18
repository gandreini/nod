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
  chatSent: pink[20],
  chatReceived: gray[15],
  play: gray[0],
  playPressed: gray[20],
  primary: pink.brand,
  primaryPressed: pink[30],
  primaryForeground: black,
  control: gray[15],
  controlActive: gray[20],
  error: '#a52842',
  errorSoft: '#fff0f2',
  mark: black,
  hairline: 'rgba(25,25,25,0.06)',
  shadow: {
    floating: '0 4px 16px rgba(25,25,25,0.08), 0 1px 2px rgba(25,25,25,0.04)',
    raised: '0 8px 32px rgba(25,25,25,0.07), 0 1px 3px rgba(25,25,25,0.04)',
    sheet: '0 -8px 32px rgba(25,25,25,0.12), 0 -1px 3px rgba(25,25,25,0.05)',
    card: '0 1px 2px rgba(25,25,25,0.04)',
  },
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
  chatSent: pink[80],
  chatReceived: gray[90],
  play: gray[80],
  playPressed: gray[70],
  primary: pink.brand,
  primaryPressed: pink[30],
  primaryForeground: black,
  control: 'rgba(250,250,250,0.12)',
  controlActive: 'rgba(250,250,250,0.16)',
  error: '#ffacb9',
  errorSoft: '#3d252e',
  mark: white,
  hairline: 'rgba(250,250,250,0.08)',
  shadow: {
    floating: '0 4px 16px rgba(0,0,0,0.45)',
    raised: '0 8px 32px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3)',
    sheet: '0 -8px 32px rgba(0,0,0,0.5)',
    card: '0 1px 2px rgba(0,0,0,0.04)',
  },
};

export type Theme = typeof light;

export const darkTheme: Theme = dark;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const font = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
};

export const radius = { control: 8, input: 12, card: 12, bubble: 16, composer: 24, full: 999 };
