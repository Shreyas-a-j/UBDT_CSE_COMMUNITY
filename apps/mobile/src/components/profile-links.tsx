'use client';

/**
 * Renders a member's optional public links. Values are re-normalized at
 * render time exactly like the website, so an unsafe or malformed URL is
 * dropped rather than becoming a tappable link.
 */

import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { normalizeProfileLinks, type ProfileLinkField } from '@/lib/profile';
import { Brand, Type } from '@/lib/theme';
import type { Profile } from '@/lib/types';

const LINKS: {
  field: ProfileLinkField;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { field: 'portfolio_url', label: 'Portfolio', icon: 'globe-outline' },
  { field: 'github_url', label: 'GitHub', icon: 'logo-github' },
  { field: 'linkedin_url', label: 'LinkedIn', icon: 'logo-linkedin' },
];

export function ProfileLinks({
  profile,
  onError,
}: {
  profile: Pick<Profile, 'portfolio_url' | 'github_url' | 'linkedin_url'>;
  onError?: (message: string) => void;
}) {
  const { values } = normalizeProfileLinks(profile);
  const available = LINKS.flatMap((link) => {
    const url = values[link.field];
    return url ? [{ ...link, url }] : [];
  });

  if (available.length === 0) return null;

  const open = (url: string) => {
    Linking.openURL(url).catch(() => onError?.('That link could not be opened.'));
  };

  return (
    <View style={styles.row}>
      {available.map((link) => (
        <Pressable
          key={link.field}
          onPress={() => open(link.url)}
          accessibilityRole="link"
          accessibilityLabel={`${link.label} (opens externally)`}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Ionicons name={link.icon} size={14} color={Brand.muted} />
          <Text style={styles.label}>{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.canvas,
  },
  label: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.muted,
  },
  pressed: {
    opacity: 0.7,
  },
});
