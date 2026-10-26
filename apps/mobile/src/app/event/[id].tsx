'use client';

/**
 * Event detail — the real `public.events` row, RSVP state and host controls.
 * Delete is confirmed first; the database still enforces host/admin-only
 * writes, so this screen is never the authorization boundary.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { EVENT_SELECT, mapEvent } from '@/lib/community';
import { isEventUpcoming } from '@/lib/feed-logic';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { Event } from '@/lib/types';
import { BackHeader, Screen } from '@/components/layout';
import { EventCard } from '@/components/event-card';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { StatusBanner } from '@/components/ui';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;
  const insets = useSafeAreaInsets();

  const [event, setEvent] = useState<Event | null>(null);
  const [going, setGoing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from('events')
        .select(EVENT_SELECT)
        .eq('id', id)
        .maybeSingle();

      if (loadError) {
        logSupabaseError('Event detail error', loadError);
        setError(loadError.message || 'This event could not be loaded.');
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!data) {
        setEvent(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setEvent(mapEvent(data as unknown as Record<string, unknown>));

      if (userId) {
        const rsvp = await supabase
          .from('event_rsvps')
          .select('event_id')
          .eq('event_id', id)
          .eq('user_id', userId)
          .maybeSingle();
        if (!rsvp.error) setGoing(Boolean(rsvp.data));
      } else {
        setGoing(false);
      }

      setLoading(false);
      setRefreshing(false);
    },
    [id, userId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRsvp = async () => {
    if (!userId || !event || busy) return;
    if (!isEventUpcoming(event)) {
      setError('This event has ended. RSVPs are closed.');
      return;
    }
    setBusy(true);
    const wasGoing = going;
    setGoing(!wasGoing);
    setEvent((previous) =>
      previous
        ? {
            ...previous,
            rsvp_count: Math.max(0, (previous.rsvp_count ?? 0) + (wasGoing ? -1 : 1)),
          }
        : previous
    );

    const { error: writeError } = wasGoing
      ? await supabase.from('event_rsvps').delete().eq('event_id', event.id).eq('user_id', userId)
      : await supabase.from('event_rsvps').insert({ event_id: event.id, user_id: userId });

    if (writeError) {
      setGoing(wasGoing);
      setEvent((previous) =>
        previous
          ? {
              ...previous,
              rsvp_count: Math.max(0, (previous.rsvp_count ?? 0) + (wasGoing ? 1 : -1)),
            }
          : previous
      );
      setError(writeError.message);
    }
    setBusy(false);
  };

  const deleteEvent = () => {
    if (!event || deletingRef.current) return;
    Alert.alert('Delete event', 'Delete this event? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (deletingRef.current) return;
          deletingRef.current = true;
          setDeleting(true);
          setError(null);
          try {
            // RLS ("Hosts can delete their events") is the server authority and
            // event_rsvps cascades. Zero returned rows means the caller is not
            // the host or the row is already gone.
            const { data, error: deleteError } = await supabase
              .from('events')
              .delete()
              .eq('id', event.id)
              .select('id');
            if (deleteError) {
              setError(deleteError.message);
              return;
            }
            if (!data || data.length === 0) {
              setError(
                'The event could not be deleted. It may already be gone, or you may not have permission.'
              );
              return;
            }
            router.back();
          } finally {
            deletingRef.current = false;
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const isHost = Boolean(
    event && userId && (event.host_id === userId || profile?.role === 'admin')
  );
  // The delete control is host-only on both platforms; admins can still use
  // the API/RLS path, but the UI does not offer it.
  const isEventHost = Boolean(event && userId && event.host_id === userId);

  return (
    <Screen bottom>
      <BackHeader title="Event" subtitle="Department calendar" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ListSkeleton count={2} />
        ) : error && !event ? (
          <ErrorState title="Event unavailable" message={error} onRetry={() => void load()} />
        ) : !event ? (
          <EmptyState
            icon="calendar-outline"
            title="Event not found"
            message="It may have been deleted, or the link is out of date."
          />
        ) : (
          <>
            {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}
            <EventCard
              event={event}
              going={going}
              busy={busy}
              onToggleRsvp={() => void toggleRsvp()}
              onEdit={
                isHost
                  ? () =>
                      router.push({ pathname: '/create-event', params: { id: event.id } })
                  : undefined
              }
              onDelete={isEventHost ? deleteEvent : undefined}
              deleting={deleting}
            />

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Event details</Text>
              <Text style={styles.infoRow}>Hosted by {event.host_name ?? 'CSE member'}</Text>
              <Text style={styles.infoRow}>
                {event.target_years.length === 4
                  ? 'Open to every batch'
                  : `For ${event.target_years.join(', ')} year students`}
              </Text>
              <Text style={styles.infoRow}>
                Times are shown in IST. The RSVP list is shared with the website.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    gap: 14,
  },
  infoCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  infoTitle: {
    fontFamily: Type.bodySemiBold,
    fontSize: 13,
    color: Brand.ink,
    marginBottom: 2,
  },
  infoRow: {
    fontFamily: Type.body,
    fontSize: 12,
    lineHeight: 18,
    color: Brand.dim,
  },
});
