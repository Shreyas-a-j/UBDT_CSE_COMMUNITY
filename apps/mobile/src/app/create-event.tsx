'use client';

/**
 * Create or edit an event. The same RLS policies as the website apply:
 * authenticated members may insert with themselves as host, and only the host
 * (or an admin) can update. No privileged fields are sent.
 */

import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { EVENT_SELECT, mapEvent, sanitizeText } from '@/lib/community';
import {
  dateToEventDate,
  eventDateToPickerDate,
  eventTimeToPickerDate,
  formatEventDate,
  formatEventTime,
  getEventDateBounds,
  isEventDateAllowed,
  timeToEventTime,
} from '@/lib/event-form';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/keyboard';
import { Brand, Type } from '@/lib/theme';
import type { EventType } from '@/lib/types';
import { BackHeader, Screen } from '@/components/layout';
import { PrimaryButton, GhostButton, SelectField, StatusBanner, TextField } from '@/components/ui';

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'Workshop', label: 'Workshop' },
  { value: 'Meeting', label: 'Meeting' },
  { value: 'Showcase', label: 'Showcase' },
  { value: 'Seminar', label: 'Seminar' },
  { value: 'Project Session', label: 'Project session' },
];

const BATCH_YEARS = [1, 2, 3, 4];

function isValidLink(value: string): boolean {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function CreateEventScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = typeof id === 'string' && id.length > 0;
  const { session, profile } = useAuth();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<EventType>('Workshop');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('17:00');
  const [duration, setDuration] = useState('60');
  const [link, setLink] = useState('');
  const [targetYears, setTargetYears] = useState<number[]>([1, 2, 3, 4]);
  const [initialEventDate, setInitialEventDate] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<'date' | 'time' | null>(null);
  const [draftPickerValue, setDraftPickerValue] = useState<Date | null>(null);
  const [loading, setLoading] = useState(editing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    let active = true;

    (async () => {
      const { data, error: loadError } = await supabase
        .from('events')
        .select(EVENT_SELECT)
        .eq('id', id)
        .maybeSingle();
      if (!active) return;
      if (loadError || !data) {
        setError(loadError?.message || 'This event could not be loaded.');
        setLoading(false);
        return;
      }
      const event = mapEvent(data as unknown as Record<string, unknown>);
      setTitle(event.title);
      setDescription(event.description);
      setType(event.type);
      setEventDate(event.event_date);
      setInitialEventDate(event.event_date);
      setEventTime(event.event_time.slice(0, 5));
      setDuration(String(event.duration));
      setLink(event.link ?? '');
      setTargetYears(event.target_years.length ? event.target_years : [1, 2, 3, 4]);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [editing, id]);

  const dateBounds = getEventDateBounds({ editingDate: initialEventDate });
  const pickerDateValue = eventDateToPickerDate(eventDate) ?? dateBounds.minimumDate;
  const pickerTimeValue = eventTimeToPickerDate(eventTime) ?? new Date(2000, 0, 1, 17, 0, 0, 0);
  const dateValue = formatEventDate(eventDate);
  const timeValue = formatEventTime(eventTime);

  const openPicker = (picker: 'date' | 'time') => {
    Keyboard.dismiss();
    setDraftPickerValue(picker === 'date' ? pickerDateValue : pickerTimeValue);
    setActivePicker(picker);
  };

  const closePicker = () => {
    setActivePicker(null);
    setDraftPickerValue(null);
  };

  const commitPicker = (value: Date) => {
    if (activePicker === 'date') setEventDate(dateToEventDate(value));
    if (activePicker === 'time') setEventTime(timeToEventTime(value));
    closePicker();
  };

  const toggleYear = (year: number) => {
    setTargetYears((previous) => {
      if (previous.includes(year)) {
        return previous.length > 1 ? previous.filter((item) => item !== year) : previous;
      }
      return [...previous, year].sort();
    });
  };

  const submit = async () => {
    if (!session?.user.id) {
      setError('Your session has expired. Sign in again to host an event.');
      return;
    }
    const cleanTitle = sanitizeText(title, 200);
    const cleanDescription = sanitizeText(description, 4000);
    const minutes = Number(duration);

    if (cleanTitle.length < 3) {
      setError('Give the event a title of at least 3 characters.');
      return;
    }
    if (cleanDescription.length < 10) {
      setError('Add at least 10 characters describing the agenda.');
      return;
    }
    if (!eventDateToPickerDate(eventDate)) {
      setError('Choose a valid event date.');
      return;
    }
    if (!isEventDateAllowed(eventDate, dateBounds)) {
      setError('Choose an event date within the allowed range.');
      return;
    }
    if (!eventTimeToPickerDate(eventTime)) {
      setError('Choose a valid start time.');
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 15 || minutes > 240) {
      setError('Duration must be between 15 and 240 minutes.');
      return;
    }
    if (!isValidLink(link.trim())) {
      setError('The link must be a valid http(s) URL.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload = {
      title: cleanTitle,
      description: cleanDescription,
      type,
      event_date: eventDate,
      event_time: eventTime,
      duration: minutes,
      link: link.trim() || null,
      target_years: targetYears,
    };

    if (editing) {
      const { error: writeError } = await supabase.from('events').update(payload).eq('id', id);
      if (writeError) {
        setError(writeError.message || 'The event could not be saved.');
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      router.back();
      return;
    }

    const { data, error: writeError } = await supabase
      .from('events')
      .insert({ ...payload, host_id: session.user.id })
      .select('id')
      .single();

    if (writeError) {
      setError(writeError.message || 'The event could not be published.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    const createdId = data?.id ? String(data.id) : null;
    if (createdId) {
      router.replace({ pathname: '/event/[id]', params: { id: createdId } });
    } else {
      router.back();
    }
  };

  return (
    <Screen bottom>
      <BackHeader
        title={editing ? 'Edit event' : 'Host an event'}
        subtitle={editing ? 'Update the session details' : profile?.name ?? 'Department calendar'}
      />
      <KeyboardAvoidingView behavior={KEYBOARD_AVOIDING_BEHAVIOR} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          {loading ? <StatusBanner kind="info">Loading event…</StatusBanner> : null}

          <TextField
            label="Title"
            placeholder="e.g. Hands-on Docker workshop for beginners"
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            editable={!submitting && !loading}
            hint={`${title.length}/200`}
          />

          <TextField
            label="Agenda"
            placeholder="What will students learn? Any prerequisites?"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={4000}
            editable={!submitting && !loading}
            hint={`${description.length}/4000`}
          />

          <View>
            <Text style={styles.label}>Type</Text>
            <View style={styles.chips}>
              {EVENT_TYPES.map((option) => {
                const active = type === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setType(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <SelectField
                label="Date"
                value={dateValue}
                placeholder="Select date"
                icon="calendar-outline"
                onPress={() => openPicker('date')}
                disabled={submitting || loading}
                accessibilityHint="Opens a calendar picker"
              />
            </View>
            <View style={styles.gridItem}>
              <SelectField
                label="Time (IST)"
                value={timeValue}
                placeholder="Select time"
                icon="time-outline"
                onPress={() => openPicker('time')}
                disabled={submitting || loading}
                accessibilityHint="Opens a 24-hour time picker"
              />
            </View>
          </View>

          {activePicker ? (
            Platform.OS === 'ios' ? (
              <View style={styles.pickerPanel}>
                <View style={styles.pickerHeader}>
                  <Text style={styles.pickerTitle}>
                    {activePicker === 'date' ? 'Choose date' : 'Choose time'}
                  </Text>
                  {activePicker === 'time' ? <Text style={styles.pickerZone}>IST</Text> : null}
                </View>
                <DateTimePicker
                  value={
                    draftPickerValue ??
                    (activePicker === 'date' ? pickerDateValue : pickerTimeValue)
                  }
                  mode={activePicker}
                  minimumDate={activePicker === 'date' ? dateBounds.minimumDate : undefined}
                  maximumDate={activePicker === 'date' ? dateBounds.maximumDate : undefined}
                  display="spinner"
                  is24Hour
                  accentColor={Brand.accent}
                  onValueChange={(_event, selected) => setDraftPickerValue(selected)}
                />
                <View style={styles.pickerActions}>
                  <View style={styles.pickerAction}>
                    <GhostButton label="Cancel" onPress={closePicker} />
                  </View>
                  <View style={styles.pickerAction}>
                    <PrimaryButton
                      label="Done"
                      onPress={() => {
                        if (draftPickerValue) commitPicker(draftPickerValue);
                      }}
                      disabled={!draftPickerValue}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <DateTimePicker
                value={activePicker === 'date' ? pickerDateValue : pickerTimeValue}
                mode={activePicker}
                minimumDate={activePicker === 'date' ? dateBounds.minimumDate : undefined}
                maximumDate={activePicker === 'date' ? dateBounds.maximumDate : undefined}
                display="default"
                presentation="dialog"
                is24Hour
                accentColor={Brand.accent}
                positiveButton={{ label: 'Set' }}
                negativeButton={{ label: 'Cancel' }}
                onValueChange={(_event, selected) => commitPicker(selected)}
                onDismiss={closePicker}
              />
            )
          ) : null}

          <TextField
            label="Duration, minutes"
            placeholder="60"
            value={duration}
            onChangeText={setDuration}
            keyboardType="number-pad"
            editable={!submitting && !loading}
            hint="15–240 minutes"
          />

          <TextField
            label="Join link (optional)"
            placeholder="https://meet.example.com/…"
            value={link}
            onChangeText={setLink}
            keyboardType="url"
            inputMode="url"
            autoCapitalize="none"
            editable={!submitting && !loading}
          />

          <View>
            <Text style={styles.label}>Audience</Text>
            <View style={styles.chips}>
              {BATCH_YEARS.map((year) => {
                const active = targetYears.includes(year);
                return (
                  <Pressable
                    key={year}
                    onPress={() => toggleYear(year)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : '4th'} year
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>At least one batch must stay selected.</Text>
          </View>

          {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}

          <View style={styles.actions}>
            <PrimaryButton
              label={editing ? 'Save changes' : 'Publish event'}
              icon={editing ? 'save-outline' : 'calendar-outline'}
              onPress={() => void submit()}
              busy={submitting}
              disabled={loading || !title.trim() || !description.trim() || !eventDate}
            />
            <Text style={styles.note}>
              Events are visible to every CSE batch unless you narrow the audience above.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    gap: 18,
  },
  label: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    color: Brand.muted,
    marginBottom: 7,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
  },
  chipActive: {
    borderColor: Brand.accent,
    backgroundColor: Brand.accentSoft,
  },
  chipText: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    color: Brand.muted,
  },
  chipTextActive: {
    color: Brand.accent,
  },
  grid: {
    flexDirection: 'row',
    gap: 10,
  },
  gridItem: {
    flex: 1,
  },
  pickerPanel: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: {
    fontFamily: Type.bodySemiBold,
    fontSize: 13,
    color: Brand.ink,
  },
  pickerZone: {
    fontFamily: Type.body,
    fontSize: 12,
    color: Brand.dim,
  },
  pickerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerAction: {
    flex: 1,
  },
  hint: {
    fontFamily: Type.body,
    fontSize: 11,
    color: Brand.dim,
    marginTop: 6,
  },
  actions: {
    gap: 12,
    marginTop: 4,
  },
  note: {
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Brand.dim,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.65,
  },
});
