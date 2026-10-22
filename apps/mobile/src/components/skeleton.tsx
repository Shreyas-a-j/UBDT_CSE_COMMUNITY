import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Brand } from '@/lib/theme';

function usePulse() {
  const [opacity] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

export function SkeletonBlock({
  height,
  width = '100%',
  radius = 6,
  style,
}: {
  height: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = usePulse();
  return (
    <Animated.View
      style={[
        styles.block,
        { height, width, borderRadius: radius, opacity },
        style,
      ]}
    />
  );
}

export function PostSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SkeletonBlock height={42} width={42} radius={21} />
        <View style={styles.column}>
          <SkeletonBlock height={12} width="45%" />
          <SkeletonBlock height={10} width="30%" style={styles.gap6} />
        </View>
      </View>
      <SkeletonBlock height={17} width="78%" style={styles.gap16} />
      <SkeletonBlock height={11} style={styles.gap10} />
      <SkeletonBlock height={11} width="88%" style={styles.gap6} />
      <View style={styles.chips}>
        <SkeletonBlock height={24} width={70} radius={12} />
        <SkeletonBlock height={24} width={54} radius={12} />
      </View>
      <View style={styles.divider} />
      <SkeletonBlock height={12} width="40%" />
    </View>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.listGap}>
          <PostSkeleton />
        </View>
      ))}
    </View>
  );
}

export function RowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.rowCard}>
          <SkeletonBlock height={46} width={46} radius={23} />
          <View style={styles.column}>
            <SkeletonBlock height={13} width="55%" />
            <SkeletonBlock height={10} width="35%" style={styles.gap6} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: Brand.elevated,
  },
  card: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  column: {
    flex: 1,
  },
  gap6: {
    marginTop: 6,
  },
  gap10: {
    marginTop: 10,
  },
  gap16: {
    marginTop: 16,
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Brand.line,
    marginTop: 16,
    marginBottom: 12,
  },
  listGap: {
    marginBottom: 12,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Brand.line,
  },
});
