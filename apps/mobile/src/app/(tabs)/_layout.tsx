'use client';

/**
 * Authenticated tab shell: Feed · Events · People · Alerts · Profile.
 *
 * React Navigation handles bottom safe-area padding, the active-tab state,
 * Android back history and keyboard hiding. The tab bar is opaque (not
 * absolute), so list content never renders underneath it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { PixelRatio } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, Type } from '@/lib/theme';
import { useUnreadNotifications } from '@/lib/unread-notifications';

export default function TabsLayout() {
  return <TabsNavigator />;
}

function TabsNavigator() {
  const insets = useSafeAreaInsets();
  const { count } = useUnreadNotifications();
  // Give labels room when the system font scale is raised, instead of
  // clipping them inside a fixed-height bar.
  const fontScale = PixelRatio.getFontScale();
  const labelExtra = Math.min(Math.max(fontScale - 1, 0) * 18, 24);

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Brand.accent,
        tabBarInactiveTintColor: Brand.dim,
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: {
          backgroundColor: Brand.tabBar,
          borderTopColor: Brand.line,
          borderTopWidth: 1,
          height: 62 + insets.bottom + labelExtra,
          paddingTop: 7,
          paddingBottom: Math.max(insets.bottom, 7),
        },
        tabBarLabelStyle: {
          fontFamily: Type.bodyMedium,
          fontSize: 11,
          marginTop: 1,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
        tabBarIconStyle: {
          marginBottom: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarAccessibilityLabel: 'Community feed',
          tabBarButtonTestID: 'tab-feed',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={23} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: 'Events',
          tabBarAccessibilityLabel: 'Events',
          tabBarButtonTestID: 'tab-events',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={22} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: 'People',
          tabBarAccessibilityLabel: 'People directory',
          tabBarButtonTestID: 'tab-people',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={23} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarAccessibilityLabel: 'Notifications',
          tabBarButtonTestID: 'tab-notifications',
          tabBarBadge: count > 0 ? (count > 99 ? '99+' : count) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Brand.accent,
            color: Brand.accentInk,
            fontFamily: Type.bodySemiBold,
            fontSize: 9,
            minWidth: 17,
            height: 17,
            lineHeight: 16,
          },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'notifications' : 'notifications-outline'} size={23} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Your profile',
          tabBarButtonTestID: 'tab-profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}
