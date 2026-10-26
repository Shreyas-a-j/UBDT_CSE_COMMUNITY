import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Brand, Type } from '@/lib/theme';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.container} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${option.label}${typeof option.count === 'number' ? `, ${option.count}` : ''}`}
            style={({ pressed }) => [
              styles.segment,
              active && styles.segmentActive,
              pressed && !active && styles.segmentPressed,
            ]}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.filter, active && styles.filterActive, pressed && styles.segmentPressed]}
          >
            <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{option.label}</Text>
            {typeof option.count === 'number' ? (
              <Text style={[styles.filterCount, active && styles.filterCountActive]}>
                {option.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 2,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
  },
  segmentActive: {
    backgroundColor: Brand.accentSoft,
    borderColor: `${Brand.accent}88`,
  },
  segmentPressed: {
    backgroundColor: Brand.pressed,
  },
  label: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
    color: Brand.muted,
    textAlign: 'center',
  },
  labelActive: {
    color: Brand.accent,
  },
  filterRow: {
    gap: 8,
    paddingHorizontal: 18,
  },
  filter: {
    minHeight: 34,
    paddingHorizontal: 13,
    justifyContent: 'center',
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterActive: {
    borderColor: Brand.accent,
    backgroundColor: Brand.accentSoft,
  },
  filterLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
    color: Brand.muted,
  },
  filterLabelActive: {
    color: Brand.accent,
  },
  filterCount: {
    fontFamily: Type.bodyMedium,
    fontSize: 10,
    color: Brand.dim,
    marginLeft: 5,
  },
  filterCountActive: {
    color: Brand.accent,
  },
});
