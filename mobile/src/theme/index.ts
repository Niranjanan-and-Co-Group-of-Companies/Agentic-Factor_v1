// The app's colours and sizes — the website's tokens (src/app/globals.css), so both look the same.
// One place to change when the brand is recoloured.

import { useColorScheme } from 'react-native';

const light = {
  bg: '#F7F3EC',
  bgSecondary: '#EFE9DF',
  card: '#FFFDF9',
  input: '#FFFDF9',
  ink: '#1B1814',
  text: '#1B1814',
  textSecondary: '#57504A',
  textMuted: '#6F675E',
  border: '#E3DBCE',
  borderStrong: '#BFB19C',
  accent: '#B93E17',
  accentSubtle: 'rgba(185, 62, 23, 0.08)',
  onAccent: '#FFFFFF',
  buttonBg: '#1B1814',
  buttonFg: '#FBF8F2',
  userBubble: '#1B1814',
  userBubbleText: '#FBF8F2',
  emerald: '#2E7A55',
  emeraldBg: 'rgba(46, 122, 85, 0.10)',
  amber: '#9A6106',
  amberBg: 'rgba(154, 97, 6, 0.11)',
  rose: '#B42318',
  roseBg: 'rgba(180, 35, 24, 0.08)',
  info: '#2D5D86',
  infoBg: 'rgba(45, 93, 134, 0.09)',
};

const dark: typeof light = {
  bg: '#131210',
  bgSecondary: '#1A1917',
  card: '#1F1D1A',
  input: '#191816',
  ink: '#0D0C0B',
  text: '#F2EDE5',
  textSecondary: '#BEB6AA',
  textMuted: '#958D82',
  border: '#2E2B27',
  borderStrong: '#565047',
  accent: '#EE7A4C',
  accentSubtle: 'rgba(238, 122, 76, 0.12)',
  onAccent: '#1B1310',
  buttonBg: '#F2EDE5',
  buttonFg: '#161411',
  userBubble: '#2A2723',
  userBubbleText: '#F2EDE5',
  emerald: '#5DBB8C',
  emeraldBg: 'rgba(93, 187, 140, 0.13)',
  amber: '#E2A845',
  amberBg: 'rgba(226, 168, 69, 0.13)',
  rose: '#F2786D',
  roseBg: 'rgba(242, 120, 109, 0.12)',
  info: '#7FB0DE',
  infoBg: 'rgba(127, 176, 222, 0.12)',
};

export type Colors = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
/** Text sizes; the system text-size setting scales them (allowFontScaling stays on). */
export const font = { xs: 12, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26 } as const;
/** Content never stretches wider than this on tablets and in landscape. */
export const maxContentWidth = 760;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
