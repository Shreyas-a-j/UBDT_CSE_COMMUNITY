import { StyleSheet, Text, View } from 'react-native';
import { Brand, Type } from '@/lib/theme';

type Tone = 'accent' | 'good' | 'warn' | 'plain' | 'error';

export function Badge({ label, tone = 'plain' }: { label: string; tone?: Tone }) {
  const color =
    tone === 'accent'
      ? Brand.accent
      : tone === 'good'
        ? Brand.success
        : tone === 'warn'
          ? Brand.warning
          : tone === 'error'
            ? Brand.error
            : Brand.muted;
  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: tone === 'plain' ? Brand.lineStrong : `${color}77`,
          backgroundColor: tone === 'plain' ? 'transparent' : `${color}14`,
        },
      ]}
    >
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: Type.bodyMedium,
    fontSize: 11,
    textTransform: 'capitalize',
  },
});
