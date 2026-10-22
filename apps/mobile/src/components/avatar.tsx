import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Type } from '@/lib/theme';
import { initials } from '@/lib/community';

const TINTS = ['#8B7CF6', '#4FB3D9', '#42C997', '#F0BC69', '#F07878', '#C084FC', '#60A5FA'];

function tintFor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 997;
  }
  return TINTS[hash % TINTS.length];
}

export function Avatar({
  name,
  uri,
  size = 42,
  square = false,
}: {
  name: string | null | undefined;
  uri?: string | null;
  size?: number;
  square?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const label = initials(name);
  const tint = tintFor(name ?? 'UCC');
  const radius = square ? size * 0.28 : size / 2;

  return (
    <View
      accessible={false}
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: `${tint}22`,
          borderColor: `${tint}77`,
        },
      ]}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: radius }}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.initial, { color: tint, fontSize: size * 0.36 }]}>{label}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: Type.displayBold,
  },
});
