import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Brand, Type } from '@/lib/theme';
import { IconButton, type IconName } from './ui';

/** Full-screen surface that respects the Android status bar. */
export function Screen({
  children,
  style,
  bottom = false,
  background = Brand.canvas,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  bottom?: boolean;
  background?: string;
}) {
  return (
    <SafeAreaView
      edges={bottom ? ['top', 'bottom'] : ['top']}
      style={[styles.screen, { backgroundColor: background }, style]}
    >
      {children}
    </SafeAreaView>
  );
}

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  right,
  compact = false,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  right?: ReactNode;
  compact?: boolean;
}) {
  return (
    <View style={[styles.pageHeader, compact && styles.pageHeaderCompact]}>
      <View style={styles.headerText}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.pageTitle} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

export function BackHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.backHeader}>
      <IconButton
        icon="chevron-back"
        label="Go back"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }}
      />
      <View style={styles.backTitleWrap}>
        <Text style={styles.backTitle} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.backSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.backRight}>{right}</View>
    </View>
  );
}

export function HeaderAction({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return <IconButton icon={icon} label={label} onPress={onPress} tone="accent" />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
  },
  pageHeaderCompact: {
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerRight: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: Type.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Brand.accent,
    marginBottom: 5,
  },
  pageTitle: {
    fontFamily: Type.displayBold,
    fontSize: 28,
    lineHeight: 34,
    color: Brand.chromeInk,
  },
  pageSubtitle: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.dim,
    marginTop: 5,
  },
  backHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    minHeight: 54,
  },
  backTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  backTitle: {
    fontFamily: Type.display,
    fontSize: 17,
    color: Brand.ink,
  },
  backSubtitle: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    marginTop: 2,
  },
  backRight: {
    width: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
