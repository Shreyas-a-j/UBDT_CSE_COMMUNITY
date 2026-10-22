'use client';

/**
 * Events tab — real upcoming and recent events, with server-backed RSVPs.
 *
 * Only data that exists in `public.events` / `public.event_rsvps` is shown.
 * Past events stay visible in a clearly separated section; the RSVP action is
 * disabled once an event has ended.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import {
  EVENT_SELECT,
  eventDateParts,
  eventStart,
  formatEventDate,
  formatEventTime,
  isEventUpcoming,
  mapEvent,
} from '@/lib/community';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { Event } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { PageHeader, Screen } from '@/components/layout';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { ActionButton, StatusBanner } from '@/components/ui';

type EventSection = { title: string; data: Event[]; past?: boolean };

export default function EventsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [events, setEvents] = useState<Event[]>([]);
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const minDate = new Date();
      minDate.setDate(minDate.getDate() - 30);
      const min = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(
        minDate.getDate()
      ).padStart(2, '0')}`;

      let result = await supabase
        .from('events')
        .select(EVENT_SELECT)
        .gte('event_date', min)
        .order('event_date', { ascending: true })
        .limit(60);

      if (result.error) {
        result = await supabase
          .from('events')
          .select('*')
          .gte('event_date', min)
          .order('event_date', { ascending: true })
          .limit(60);
      }

      if (result.error) {
        logSupabaseError('Events error', result.error);
        setError(result.error.message || 'Events could not be loaded.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setEvents(((result.data ?? []) as unknown as Record<string, unknown>[]).map(mapEvent));
      setLoading(false);
      setRefreshing(false);

      if (userId) {
        const rsvps = await supabase.from('event_rsvps').select('event_id').eq('user_id', userId);
        if (!rsvps.error && rsvps.data) {
          setRsvpIds(new Set(rsvps.data.map((row) => String(row.event_id))));
        }
      } else {
        setRsvpIds(new Set());
      }
    },
    [userId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo<EventSection[]>(() => {
    const upcoming = events
      .filter((event) => isEventUpcoming(event, now))
      .sort((a, b) => (eventStart(a)?.getTime() ?? 0) - (eventStart(b)?.getTime() ?? 0));
    const past = events
      .filter((event) => !isEventUpcoming(event, now))
      .sort((a, b) => (eventStart(b)?.getTime() ?? 0) - (eventStart(a)?.getTime() ?? 0));

    const next: EventSection[] = [];
    if (upcoming.length) next.push({ title: 'Upcoming', data: upcoming });
    if (past.length) next.push({ title: 'Recently ended', data: past.slice(0, 20), past: true });
    return next;
  }, [events, now]);

  const toggleRsvp = useCallback(
    async (event: Event) => {
      if (!userId || busyId) return;
      if (!isEventUpcoming(event, new Date())) return;
      setBusyId(event.id);
      setActionError(null);
      const wasGoing = rsvpIds.has(event.id);

      setRsvpIds((previous) => {
        const next = new Set(previous);
        if (wasGoing) next.delete(event.id);
        else next.add(event.id);
        return next;
      });
      setEvents((previous) =>
        previous.map((row) =>
          row.id === event.id
            ? { ...row, rsvp_count: Math.max(0, (row.rsvp_count ?? 0) + (wasGoing ? -1 : 1)) }
            : row
        )
      );

      const { error: writeError } = wasGoing
        ? await supabase.from('event_rsvps').delete().eq('event_id', event.id).eq('user_id', userId)
        : await supabase.from('event_rsvps').insert({ event_id: event.id, user_id: userId });

      if (writeError) {
        setRsvpIds((previous) => {
          const next = new Set(previous);
          if (wasGoing) next.add(event.id);
          else next.delete(event.id);
          return next;
        });
        setEvents((previous) =>
          previous.map((row) =>
            row.id === event.id
              ? { ...row, rsvp_count: Math.max(0, (row.rsvp_count ?? 0) + (wasGoing ? 1 : -1)) }
              : row
          )
        );
        setActionError(writeError.message);
      }
      setBusyId(null);
    },
    [busyId, rsvpIds, userId]
  );

  const header = (
    <View>
      <PageHeader
        eyebrow="Department calendar"
        title="Events"
        subtitle="Workshops, seminars and project sessions across every CSE batch."
        /> 
      {actionError ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="error">{actionError}</StatusBanner>
        </View>
      ) : null}
      {error && events.length > 0 ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="warning">{error}</StatusBanner>
        </View>
      ) : null}
      {!loading && sections.length === 0 && !error ? (
        <EmptyState
          icon="calendar-outline"
          title="No events on the calendar"
          message="When faculty or students host a workshop, seminar or project session, it will appear here."
        />
      ) : null}
    </View>
  );

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item, section }) => (
          <EventCard
            event={item}
            past={Boolean(section.past)}
            going={rsvpIds.has(item.id)}
            busy={busyId === item.id}
            onToggleRsvp={() => void toggleRsvp(item)}
          />
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={loading ? <ListSkeleton count={3} /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : undefined}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        SectionSeparatorComponent={() => <View style={styles.sectionSeparator} />}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
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

function EventCard({
  event,
  past,
  going,
  busy,
  onToggleRsvp,
}: {
  event: Event;
  past: boolean;
  going: boolean;
  busy: boolean;
  onToggleRsvp: () => void;
}) {
  const date = eventDateParts(event);

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.dateBlock}>
          <Text style={styles.dateDay}>{date.day}</Text>
          <Text style={styles.dateMonth}>{date.month}</Text>
        </View>
        <View style={styles.cardHeading}>
          <View style={styles.typeRow}>
            <Badge label={event.type} tone="accent" />
            {past ? <Badge label="Ended" /> : null}
          </View>
          <Text style={styles.eventTitle} numberOfLines={3}>
            {event.title}
          </Text>
          <Text style={styles.eventTime}>
            {formatEventDate(event)} · {formatEventTime(event.event_time)} · {event.duration} min
          </Text>
        </View>
      </View>

      <Text style={styles.description} numberOfLines={4}>
        {event.description}
      </Text>

      <View style={styles.hostRow}>
        <Avatar name={event.host_name} uri={event.host_avatar} size={30} />
        <Text style={styles.host} numberOfLines={1}>
          Hosted by <Text style={styles.hostName}>{event.host_name}</Text>
        </Text>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.rsvpCount}>
          <Ionicons name="people-outline" size={16} color={Brand.dim} />
          <Text style={styles.rsvpCountText}>
            {event.rsvp_count ?? 0} {(event.rsvp_count ?? 0) === 1 ? 'person going' : 'people going'}
          </Text>
        </View>
        <View style={styles.cardActions}>
          {event.link ? (
            <ActionButton
              label="Join link"
              icon="open-outline"
              onPress={() => {
                void Linking.openURL(event.link!).catch(() => undefined);
              }}
            />
          ) : null}
          <Pressable
            onPress={onToggleRsvp}
            disabled={past || busy}
            accessibilityRole="button"
            accessibilityLabel={past ? 'Event ended' : going ? 'Cancel RSVP' : 'RSVP to event'}
            accessibilityState={{ selected: going, disabled: past || busy, busy }}
            style={({ pressed }) => [
              styles.rsvpButton,
              going && styles.rsvpGoing,
              (past || busy) && styles.rsvpDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={going ? 'checkmark-circle' : past ? 'time-outline' : 'add-circle-outline'}
              size={16}
              color={past ? Brand.dim : going ? Brand.success : Brand.accent}
            />
            <Text style={[styles.rsvpLabel, going && { color: Brand.success }, past && { color: Brand.dim }]}>
              {past ? 'Ended' : going ? 'Going' : 'RSVP'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  bannerWrap: {
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontFamily: Type.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  sectionCount: {
    fontFamily: Type.bodyMedium,
    fontSize: 10.5,
    color: Brand.dim,
    backgroundColor: Brand.elevated,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  separator: {
    height: 12,
  },
  sectionSeparator: {
    height: 6,
  },
  card: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
  },
  cardTop: {
    flexDirection: 'row',
    gap: 13,
  },
  dateBlock: {
    width: 52,
    height: 58,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
    backgroundColor: Brand.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDay: {
    fontFamily: Type.displayBold,
    fontSize: 21,
    lineHeight: 24,
    color: Brand.accent,
  },
  dateMonth: {
    fontFamily: Type.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Brand.accent,
  },
  cardHeading: {
    flex: 1,
    minWidth: 0,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  eventTitle: {
    fontFamily: Type.display,
    fontSize: 17,
    lineHeight: 22,
    color: Brand.ink,
    marginTop: 7,
  },
  eventTime: {
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Brand.dim,
    marginTop: 4,
  },
  description: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 20,
    color: Brand.muted,
    marginTop: 13,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 13,
  },
  host: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
  },
  hostName: {
    fontFamily: Type.bodyMedium,
    color: Brand.muted,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  rsvpCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  rsvpCountText: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rsvpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}88`,
    backgroundColor: Brand.accentSoft,
  },
  rsvpGoing: {
    borderColor: `${Brand.success}77`,
    backgroundColor: 'rgba(66, 201, 151, 0.10)',
  },
  rsvpDisabled: {
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
  },
  rsvpLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
    color: Brand.accent,
  },
  pressed: {
    opacity: 0.7,
  },
});
