import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from './avatar';
import { Badge } from './badge';
import { LinkifiedText } from './linkified-text';
import { eventDateParts, formatEventDate, formatEventTime } from '@/lib/community';
import { getEventPhase } from '@/lib/feed-logic';
import { Brand, Type } from '@/lib/theme';
import type { Event } from '@/lib/types';

/**
 * Shared event card used by the feed, the events tab and the event detail
 * screen. Renders the real `public.events` row; RSVP is disabled once the
 * event has ended. Hosts get edit/delete actions when callbacks are supplied.
 */
export function EventCard({
  event,
  compact = false,
  going = false,
  busy = false,
  onPress,
  onToggleRsvp,
  onEdit,
  onDelete,
  deleting = false,
  now,
}: {
  event: Event;
  compact?: boolean;
  going?: boolean;
  busy?: boolean;
  onPress?: () => void;
  onToggleRsvp?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  now?: Date;
}) {
  const date = eventDateParts(event);
  const phase = getEventPhase(event, now ?? new Date());
  const ended = phase === 'ended';

  const body = (
    <>
      <View style={styles.cardTop}>
        <View style={styles.dateBlock}>
          <Text style={styles.dateDay}>{date.day}</Text>
          <Text style={styles.dateMonth}>{date.month}</Text>
        </View>
        <View style={styles.cardHeading}>
          <View style={styles.typeRow}>
            <Badge label={event.type} tone="accent" />
            {phase === 'live' ? <Badge label="Live" tone="good" /> : null}
            {ended ? <Badge label="Ended" /> : null}
          </View>
          <Text style={styles.title} numberOfLines={compact ? 2 : 3}>
            {event.title}
          </Text>
          <Text style={styles.time}>
            {formatEventDate(event)} · {formatEventTime(event.event_time)} IST · {event.duration} min
          </Text>
        </View>
        {onEdit || onDelete ? (
          <View style={styles.ownerActions}>
            {onEdit ? (
              <Pressable
                onPress={onEdit}
                accessibilityRole="button"
                accessibilityLabel="Edit event"
                hitSlop={6}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <Ionicons name="create-outline" size={17} color={Brand.muted} />
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable
                onPress={onDelete}
                disabled={deleting}
                accessibilityRole="button"
                accessibilityLabel="Delete event"
                accessibilityState={{ disabled: deleting }}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && styles.pressed,
                  deleting && styles.disabled,
                ]}
              >
                <Ionicons name="trash-outline" size={17} color={Brand.error} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {!compact ? (
        <LinkifiedText text={event.description} style={styles.description} numberOfLines={4} />
      ) : null}

      {!compact ? (
        <View style={styles.hostRow}>
          <Avatar name={event.host_name} uri={event.host_avatar} size={28} />
          <Text style={styles.host} numberOfLines={1}>
            Hosted by <Text style={styles.hostName}>{event.host_name ?? 'CSE member'}</Text>
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.rsvpCount}>
          <Ionicons name="people-outline" size={15} color={Brand.dim} />
          <Text style={styles.rsvpCountText}>
            {event.rsvp_count ?? 0} {(event.rsvp_count ?? 0) === 1 ? 'person going' : 'people going'}
          </Text>
        </View>
        <View style={styles.actions}>
          {event.link ? (
            <Pressable
              onPress={() => {
                void Linking.openURL(event.link!).catch(() => undefined);
              }}
              accessibilityRole="link"
              accessibilityLabel="Open event link"
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
            >
              <Ionicons name="open-outline" size={14} color={Brand.accent} />
              <Text style={styles.linkLabel}>Join</Text>
            </Pressable>
          ) : null}
          {onToggleRsvp ? (
            <Pressable
              onPress={onToggleRsvp}
              disabled={ended || busy}
              accessibilityRole="button"
              accessibilityLabel={ended ? 'Event ended' : going ? 'Cancel RSVP' : 'RSVP to event'}
              accessibilityState={{ selected: going, disabled: ended || busy, busy }}
              style={({ pressed }) => [
                styles.rsvpButton,
                going && styles.rsvpGoing,
                (ended || busy) && styles.rsvpDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={going ? 'checkmark-circle' : ended ? 'time-outline' : 'add-circle-outline'}
                size={15}
                color={ended ? Brand.dim : going ? Brand.success : Brand.accent}
              />
              <Text
                style={[
                  styles.rsvpLabel,
                  going && { color: Brand.success },
                  ended && { color: Brand.dim },
                ]}
              >
                {ended ? 'Ended' : going ? 'Going' : 'RSVP'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </>
  );

  if (!onPress) return <View style={styles.card}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open event: ${event.title}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
  },
  cardPressed: {
    borderColor: Brand.lineStrong,
    backgroundColor: '#282A2F',
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
  title: {
    fontFamily: Type.display,
    fontSize: 17,
    lineHeight: 22,
    color: Brand.ink,
    marginTop: 7,
  },
  time: {
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Brand.dim,
    marginTop: 4,
  },
  ownerActions: {
    flexDirection: 'row',
    gap: 2,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
  footer: {
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  linkLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    color: Brand.accent,
  },
  rsvpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
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
  disabled: {
    opacity: 0.4,
  },
});
