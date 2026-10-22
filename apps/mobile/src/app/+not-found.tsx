'use client';

/** Fallback route for unknown deep links and stale notification URLs. */

import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import { Brand, Type } from '@/lib/theme';
import { Screen } from '@/components/layout';
import { PrimaryButton } from '@/components/ui';
import { Wordmark } from '@/components/wordmark';

export default function NotFoundScreen() {
  return (
    <Screen bottom>
      <View style={styles.wrap}>
        <Wordmark size="large" />
        <View style={styles.icon}>
          <Ionicons name="compass-outline" size={25} color={Brand.accent} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          This page does not exist
        </Text>
        <Text style={styles.copy}>
          The link may be out of date, or the content it pointed to has moved. Head back to the
          community feed and continue from there.
        </Text>
        <View style={styles.action}>
          <PrimaryButton label="Back to the feed" icon="home-outline" onPress={() => router.replace('/')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  icon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}44`,
    marginTop: 34,
  },
  title: {
    fontFamily: Type.display,
    fontSize: 22,
    lineHeight: 28,
    color: Brand.ink,
    marginTop: 16,
  },
  copy: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 20,
    color: Brand.dim,
    marginTop: 8,
    maxWidth: 380,
  },
  action: {
    marginTop: 22,
    alignSelf: 'flex-start',
    minWidth: 220,
  },
});
