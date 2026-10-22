/**
 * UCC wordmark and monogram, used on sign-in, home header, and splash.
 *
 * The one deliberately expressive element in the app: Space Grotesk
 * wordmark over a short violet bar — everything else in the UI stays quiet.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Brand, Type } from '@/lib/theme';

export function Wordmark({ size = 'large' }: { size?: 'large' | 'small' }) {
  const fontSize = size === 'large' ? 44 : 18;
  const barWidth = size === 'large' ? 64 : 26;
  return (
    <View style={styles.wrap} accessible accessibilityRole="header">
      <Text style={[styles.word, { fontSize }]}>UCC</Text>
      <View style={[styles.bar, { width: barWidth }]} />
    </View>
  );
}

export function Subtitle({ children }: { children: string }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
  },
  word: {
    fontFamily: Type.displayBold,
    color: Brand.chromeInk,
    letterSpacing: 4,
  },
  bar: {
    height: 3,
    marginTop: 8,
    borderRadius: 2,
    backgroundColor: Brand.accent,
  },
  subtitle: {
    fontFamily: Type.body,
    fontSize: 14,
    color: Brand.chromeMuted,
    marginTop: 14,
    lineHeight: 21,
  },
});
