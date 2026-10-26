import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Brand, Type } from '@/lib/theme';
import type { IconName } from './ui';

/** Section heading with a count and optional trailing action. */
export function SectionHeader({
  title,
  count,
  icon,
  action,
}: {
  title: string;
  count?: number;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.titleRow}>
        {icon ? <Ionicons name={icon} size={15} color={Brand.accent} /> : null}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {typeof count === 'number' ? <Text style={styles.count}>{count}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function InlineAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Text style={styles.actionText}>{label}</Text>
      {icon ? <Ionicons name={icon} size={12} color={Brand.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  title: {
    fontFamily: Type.bodySemiBold,
    fontSize: 14,
    color: Brand.ink,
  },
  count: {
    fontFamily: Type.bodyMedium,
    fontSize: 10.5,
    color: Brand.dim,
    backgroundColor: Brand.elevated,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 32,
  },
  actionText: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.accent,
  },
  pressed: {
    opacity: 0.65,
  },
});
