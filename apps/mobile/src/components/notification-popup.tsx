'use client';

/**
 * Launch/foreground notification popup.
 *
 * One row is fetched per genuine launch or background-to-foreground
 * transition. Realtime inserts are left to the Alerts tab and badge; they must
 * never open this modal while the user is already active. Seen ids are kept in
 * memory for the session, so Dismiss hides a row without deleting it or
 * marking it read.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import { PrimaryButton, GhostButton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { logSupabaseError } from '@/lib/errors';
import { HIDDEN_NOTIFICATION_FILTER } from '@/lib/notifications';
import { popupHref, selectPopupNotification } from '@/lib/notification-popup';
import { supabase } from '@/lib/supabase';
import { Brand, Radius, Type } from '@/lib/theme';
import type { Notification } from '@/lib/types';
import { useUnreadNotifications } from '@/lib/unread-notifications';

export function NotificationPopup() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const unread = useUnreadNotifications();
  const [candidate, setCandidate] = useState<Notification | null>(null);
  const seenRef = useRef(new Set<string>());
  const checkRequestedRef = useRef(false);
  const activeRef = useRef(AppState.currentState === 'active');
  const userIdRef = useRef<string | null>(userId);
  const requestSeqRef = useRef(0);
  const actingRef = useRef(false);

  const runCheck = useCallback(async () => {
    const checkedUserId = userIdRef.current;
    if (!checkedUserId || !activeRef.current || !checkRequestedRef.current) return;
    checkRequestedRef.current = false;
    const sequence = requestSeqRef.current + 1;
    requestSeqRef.current = sequence;

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', checkedUserId)
        .eq('read', false)
        .not('type', 'in', HIDDEN_NOTIFICATION_FILTER)
        .order('created_at', { ascending: false })
        .limit(20);

      if (sequence !== requestSeqRef.current) return;
      if (userIdRef.current !== checkedUserId || !activeRef.current) return;
      if (error) {
        logSupabaseError('NotificationPopup load failed', error);
        return;
      }

      const next = selectPopupNotification(
        (data ?? []) as Notification[],
        seenRef.current
      );
      if (next) setCandidate(next);
    } catch (err) {
      if (sequence === requestSeqRef.current) {
        logSupabaseError('NotificationPopup load failed', err);
      }
    }
  }, []);

  const requestCheck = useCallback(() => {
    checkRequestedRef.current = true;
    void Promise.resolve().then(runCheck);
  }, [runCheck]);

  // Genuine background-to-foreground transitions only; repeated "active"
  // events while already active must not open another modal.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const wasActive = activeRef.current;
      activeRef.current = next === 'active';
      if (next === 'active' && !wasActive) requestCheck();
    });
    return () => subscription.remove();
  }, [requestCheck]);

  // A new signed-in account starts a fresh session; signing out closes any
  // open card and clears the seen set. This also covers the initial
  // authenticated mount, so there is no separate launch effect to race it.
  useEffect(() => {
    userIdRef.current = userId;
    seenRef.current.clear();
    checkRequestedRef.current = false;
    void Promise.resolve().then(() => setCandidate(null));
    if (userId) requestCheck();
  }, [userId, requestCheck]);

  const dismiss = () => {
    if (!candidate) return;
    seenRef.current.add(candidate.id);
    setCandidate(null);
  };

  const view = async () => {
    if (!candidate || actingRef.current) return;
    actingRef.current = true;
    const target = candidate;
    seenRef.current.add(target.id);
    setCandidate(null);

    try {
      if (!target.read) {
        const { error } = await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', target.id);
        if (error) logSupabaseError('NotificationPopup mark read failed', error);
      }
      await unread.refresh();
    } catch (err) {
      logSupabaseError('NotificationPopup mark read failed', err);
    } finally {
      actingRef.current = false;
      if (userIdRef.current === target.user_id) router.push(popupHref(target));
    }
  };

  if (!candidate) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={dismiss}
          accessible={false}
        />
        <View
          style={styles.card}
          accessibilityViewIsModal
          accessibilityLiveRegion="polite"
        >
          <View style={styles.heading}>
            <View style={styles.icon}>
              <Ionicons name="notifications-outline" size={18} color={Brand.accent} />
            </View>
            <Text style={styles.title} accessibilityRole="header">
              {candidate.title}
            </Text>
          </View>
          {candidate.body ? <Text style={styles.body}>{candidate.body}</Text> : null}
          <View style={styles.actions}>
            <PrimaryButton label="View" onPress={() => void view()} />
            <GhostButton label="Dismiss" onPress={dismiss} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Brand.scrim,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
    backgroundColor: Brand.surface,
    padding: 18,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
  },
  title: {
    flex: 1,
    paddingTop: 5,
    fontFamily: Type.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: Brand.ink,
  },
  body: {
    marginTop: 10,
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.muted,
  },
  actions: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 10,
  },
});
