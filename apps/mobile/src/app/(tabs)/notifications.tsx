'use client';

/**
 * Notifications tab — RLS already restricts rows to the signed-in user. Rows
 * are real server records; opening one marks it read and routes to the
 * relevant destination using the notification type (and message link).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useUnreadNotifications } from '@/lib/unread-notifications';
import { formatRelativeTime } from '@/lib/community';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { Notification, NotificationType } from '@/lib/types';
import { PageHeader, Screen } from '@/components/layout';
import { RowSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { ActionButton, StatusBanner } from '@/components/ui';

const ICONS: Record<NotificationType, React.ComponentProps<typeof Ionicons>['name']> = {
  comment: 'chatbubble-outline',
  rsvp: 'calendar-outline',
  event_reminder: 'alarm-outline',
  like: 'heart-outline',
  upvote: 'arrow-up-circle-outline',
  connection_request: 'person-add-outline',
  connection_accepted: 'people-outline',
  message: 'mail-outline',
  announcement: 'megaphone-outline',
  faculty_decision: 'ribbon-outline',
};

function routeFor(notification: Notification) {
  if (notification.type === 'message') {
    const match = notification.link?.match(/^\/messages\/([0-9a-f-]+)/i);
    if (match) {
      router.push({ pathname: '/messages/[id]', params: { id: match[1] } });
      return;
    }
    router.navigate({ pathname: '/network', params: { tab: 'messages' } });
    return;
  }
  if (notification.type === 'connection_request') {
    router.navigate({ pathname: '/network', params: { tab: 'requests' } });
    return;
  }
  if (notification.type === 'connection_accepted') {
    router.navigate({ pathname: '/network', params: { tab: 'connections' } });
    return;
  }
  if (notification.type === 'faculty_decision') {
    router.navigate('/profile');
    return;
  }
  router.navigate('/');
}

export default function NotificationsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const unread = useUnreadNotifications();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (!userId) {
        setLoading(false);
        return;
      }
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(60);

      if (queryError) {
        logSupabaseError('Notifications error', queryError);
        setError(queryError.message || 'Notifications could not be loaded.');
      } else {
        setNotifications((data ?? []) as Notification[]);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [userId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-list:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const next = payload.new as Notification;
          setNotifications((previous) => {
            if (previous.some((item) => item.id === next.id)) return previous;
            return [next, ...previous].slice(0, 60);
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  const markAllRead = async () => {
    if (!userId || unreadCount === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
    if (updateError) {
      setActionError(updateError.message);
    } else {
      setNotifications((previous) => previous.map((item) => ({ ...item, read: true })));
      await unread.refresh();
    }
    setBusy(false);
  };

  const openNotification = async (notification: Notification) => {
    if (!notification.read) {
      setNotifications((previous) =>
        previous.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
      );
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notification.id);
      if (updateError) setActionError(updateError.message);
      await unread.refresh();
    }
    routeFor(notification);
  };

  const header = (
    <View>
      <PageHeader
        eyebrow="Activity"
        title="Notifications"
        subtitle="Replies, requests and community updates addressed to you."
        right={
          unreadCount > 0 ? (
            <ActionButton
              label="Read all"
              icon="checkmark-done-outline"
              tone="accent"
              busy={busy}
              onPress={() => void markAllRead()}
            />
          ) : undefined
        }
      />
      {actionError ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="error">{actionError}</StatusBanner>
        </View>
      ) : null}
      {!loading && notifications.length > 0 ? (
        <Text style={styles.summary}>
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'} · {notifications.length} total
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <NotificationRow notification={item} onPress={() => void openNotification(item)} />
        )}
        ListEmptyComponent={
          loading ? (
            <RowSkeleton count={5} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : (
            <EmptyState
              icon="notifications-off-outline"
              title="No notifications yet"
              message="When someone replies, connects or messages you, it will show up here."
            />
          )
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

function NotificationRow({
  notification,
  onPress,
}: {
  notification: Notification;
  onPress: () => void;
}) {
  const unread = !notification.read;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread: ' : ''}${notification.title}`}
      style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.pressed]}
    >
      <View style={[styles.icon, unread && styles.iconUnread]}>
        <Ionicons
          name={ICONS[notification.type] ?? 'notifications-outline'}
          size={19}
          color={unread ? Brand.accent : Brand.dim}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={2}>
            {notification.title}
          </Text>
          <Text style={styles.time}>{formatRelativeTime(notification.created_at)}</Text>
        </View>
        {notification.body ? (
          <Text style={styles.message} numberOfLines={3}>
            {notification.body}
          </Text>
        ) : null}
      </View>
      {unread ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
    flexGrow: 1,
  },
  bannerWrap: {
    marginTop: 2,
    marginBottom: 10,
  },
  summary: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    marginBottom: 10,
  },
  separator: {
    height: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 13,
  },
  rowUnread: {
    borderColor: `${Brand.accent}66`,
    backgroundColor: 'rgba(139, 124, 246, 0.055)',
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  iconUnread: {
    backgroundColor: Brand.accentSoft,
    borderColor: `${Brand.accent}44`,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flex: 1,
    fontFamily: Type.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    color: Brand.muted,
  },
  titleUnread: {
    fontFamily: Type.bodySemiBold,
    color: Brand.ink,
  },
  time: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
    paddingTop: 1,
  },
  message: {
    fontFamily: Type.body,
    fontSize: 12,
    lineHeight: 17,
    color: Brand.dim,
    marginTop: 3,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Brand.accent,
    marginTop: 6,
  },
  pressed: {
    opacity: 0.7,
  },
});
