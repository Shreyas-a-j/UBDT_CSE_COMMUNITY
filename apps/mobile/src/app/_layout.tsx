'use client';

/**
 * Root layout — UCC-branded app shell.
 *
 * - Loads the brand fonts while the native splash stays visible.
 * - Wraps everything in AuthProvider (same session/profile behavior as the
 *   web app, persisted via Expo SecureStore).
 * - Uses Expo Router protected routes so authentication is enforced by the
 *   navigator, not by per-screen redirect effects. Signed-out users only see
 *   the sign-in route; signed-in users only see the tab shell and its detail
 *   screens. Signing out removes protected history automatically.
 */

import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { Brand, Type } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {
  /* splash already hidden or unavailable */
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {
      /* nothing to hide */
    });
  }, [ready]);

  return (
    <SafeAreaProvider>
      <AuthProvider>{ready ? <RootNavigator /> : null}</AuthProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashWord}>UCC</Text>
        <View style={styles.splashBar} />
        <ActivityIndicator color={Brand.accent} size="small" style={styles.spinner} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Brand.canvas },
        animation: 'fade',
      }}
    >
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="post/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="create-post" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="messages/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="people" options={{ animation: 'slide_from_right' }} />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.chrome,
  },
  splashWord: {
    fontFamily: Type.displayBold,
    fontSize: 48,
    letterSpacing: 6,
    color: Brand.chromeInk,
  },
  splashBar: {
    width: 70,
    height: 3,
    borderRadius: 2,
    backgroundColor: Brand.accent,
    marginTop: 8,
  },
  spinner: {
    marginTop: 28,
  },
});
