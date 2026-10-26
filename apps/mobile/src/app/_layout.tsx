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

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, router, type Href } from 'expo-router';
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
import { initializeAndroidPush, syncPushIdentity } from '@/lib/onesignal';
import { UnreadNotificationsProvider } from '@/lib/unread-notifications';
import { AdminNominationBanner } from '@/components/admin-nomination-banner';
import { NotificationPopup } from '@/components/notification-popup';
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
      <AuthProvider>
        {ready ? (
          <UnreadNotificationsProvider>
            <RootNavigator />
          </UnreadNotificationsProvider>
        ) : null}
      </AuthProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();
  const userId = session?.user.id ?? null;
  const [pushRoute, setPushRoute] = useState<Href | null>(null);

  // OneSignal initializes once, on Android only. The SDK never prompts here;
  // permission is requested from the notifications screen's explicit control.
  useEffect(() => {
    void initializeAndroidPush(setPushRoute);
  }, []);

  // Wait for the session restore before reconciling identity so a cold start
  // does not briefly log the device out of its persisted external id.
  useEffect(() => {
    if (loading) return;
    void syncPushIdentity(userId);
  }, [loading, userId]);

  // Navigation is deferred until auth loading finishes so a cold-start
  // notification tap lands inside the mounted, protected navigator.
  useEffect(() => {
    if (loading || !pushRoute) return;
    const timer = setTimeout(() => {
      setPushRoute(null);
      router.push(pushRoute);
    }, 0);
    return () => clearTimeout(timer);
  }, [loading, pushRoute]);

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
    <>
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
          <Stack.Screen name="create-event" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="event/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="announcements/index" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="announcements/create" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="announcements/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="people/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="faculty/dashboard" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="admin/index" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="profile/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack.Protected>

        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          <Stack.Screen name="sign-up" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="forgot-password" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
      </Stack>
      {session ? <AdminNominationBanner /> : null}
      {session ? <NotificationPopup /> : null}
    </>
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
