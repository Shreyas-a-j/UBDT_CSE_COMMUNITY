import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Brand, Type } from '@/lib/theme';
import type { IconName } from './ui';

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={26} color={Brand.accent} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retrying,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, styles.iconError]}>
        <Ionicons name="cloud-offline-outline" size={26} color={Brand.error} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        onPress={onRetry}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityLabel="Retry loading"
        style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
      >
        {retrying ? (
          <ActivityIndicator size="small" color={Brand.accent} />
        ) : (
          <>
            <Ionicons name="refresh" size={16} color={Brand.accent} />
            <Text style={styles.retryLabel}>Try again</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

export function InlineLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.inline}>
      <ActivityIndicator color={Brand.accent} size="small" />
      <Text style={styles.inlineLabel}>{label}</Text>
    </View>
  );
}

export function ListFooter({ visible, label = 'Loading more' }: { visible: boolean; label?: string }) {
  if (!visible) return null;
  return (
    <View style={styles.footer}>
      <ActivityIndicator color={Brand.accent} size="small" />
      <Text style={styles.inlineLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 44,
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}44`,
  },
  iconError: {
    backgroundColor: 'rgba(240, 120, 120, 0.10)',
    borderColor: 'rgba(240, 120, 120, 0.35)',
  },
  title: {
    fontFamily: Type.display,
    fontSize: 18,
    color: Brand.ink,
    marginTop: 16,
    textAlign: 'center',
  },
  message: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.dim,
    marginTop: 7,
    textAlign: 'center',
    maxWidth: 320,
  },
  action: {
    marginTop: 20,
    alignSelf: 'stretch',
    maxWidth: 300,
    width: '100%',
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 20,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}88`,
    backgroundColor: Brand.accentSoft,
  },
  retryLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 13.5,
    color: Brand.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 26,
  },
  inlineLabel: {
    fontFamily: Type.body,
    fontSize: 12.5,
    color: Brand.dim,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 22,
  },
});
