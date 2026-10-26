'use client';

/**
 * Nominee banner — mobile parity with the website.
 *
 * A nominee is not an administrator yet, so this lives at the signed-in root
 * rather than on the admin screen. Accept/decline call the SECURITY DEFINER
 * succession RPCs; the client never writes `profiles.role`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Brand, Type } from '@/lib/theme';
import { GhostButton, PrimaryButton, StatusBanner } from './ui';

interface Nomination {
  id: string;
  nominated_by: string;
  nominee_id: string;
  status: string;
  note: string | null;
  created_at: string;
  nominator?: { name: string } | null;
}

export function AdminNominationBanner() {
  const { profile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [nomination, setNomination] = useState<Nomination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error: loadError } = await supabase
      .from('admin_nominations')
      .select('*, nominator:profiles!nominated_by (name)')
      .eq('nominee_id', profile.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError(null);
    setNomination((data ?? null) as Nomination | null);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) {
      setNomination(null);
      return;
    }
    void load();
  }, [profile?.id, load]);

  useEffect(() => {
    if (!profile?.id) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => subscription.remove();
  }, [profile?.id, load]);

  const respond = useCallback(
    (decision: 'accept' | 'decline') => {
      if (busyRef.current || !nomination) return;
      const accepted = decision === 'accept';

      Alert.alert(
        accepted ? 'Accept nomination' : 'Decline nomination',
        accepted
          ? 'Accept the administrator nomination? You will become the only administrator.'
          : 'Decline this nomination? The current administrator stays in place.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: accepted ? 'Accept' : 'Decline',
            style: accepted ? 'default' : 'destructive',
            onPress: async () => {
              if (busyRef.current) return;
              busyRef.current = true;
              setBusy(true);
              setError(null);
              try {
                const { error: rpcError } = await supabase.rpc(
                  accepted ? 'accept_admin_nomination' : 'decline_admin_nomination',
                  { p_id: nomination.id }
                );
                if (rpcError) {
                  setError(rpcError.message);
                  return;
                }
                setNomination(null);
                await refreshProfile();
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : 'The nomination could not be updated. Try again.'
                );
              } finally {
                busyRef.current = false;
                setBusy(false);
              }
            },
          },
        ]
      );
    },
    [nomination, refreshProfile]
  );

  if (!profile?.id || !nomination) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.wrap, { top: insets.top + 8 }]}
    >
      <View style={styles.card}>
        <View style={styles.heading}>
          <View style={styles.icon}>
            <Ionicons name="shield-checkmark-outline" size={16} color={Brand.accent} />
          </View>
          <Text style={styles.copy}>
            <Text style={styles.strong}>
              {nomination.nominator?.name || 'The current administrator'}
            </Text>{' '}
            nominated you as administrator.
          </Text>
        </View>
        {nomination.note ? <Text style={styles.note}>{nomination.note}</Text> : null}
        {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}
        <View style={styles.actions}>
          <PrimaryButton
            label="Accept"
            icon="checkmark-outline"
            onPress={() => respond('accept')}
            busy={busy}
            disabled={busy}
          />
          <GhostButton
            label="Decline"
            icon="close-outline"
            onPress={() => respond('decline')}
            disabled={busy}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 100,
    elevation: 12,
  },
  card: {
    backgroundColor: Brand.elevated,
    borderColor: `${Brand.accent}77`,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    padding: 13,
    gap: 9,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.ink,
  },
  strong: { fontFamily: Type.bodySemiBold },
  note: {
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Brand.muted,
    fontStyle: 'italic',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
