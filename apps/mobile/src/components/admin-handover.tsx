'use client';

/**
 * Administrator handover — mobile parity with the website card.
 *
 * Every write goes through the database succession RPCs. This component never
 * updates `profiles.role` or writes the nomination/audit tables, and it does
 * not expose resignation or operator recovery.
 */

import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { adminActionLabel, nominationStatusLabel, type AdminNominee } from '@/lib/admin';
import { formatRelativeTime } from '@/lib/community';
import { isAdmin } from '@/lib/profile';
import { Brand, Type } from '@/lib/theme';
import { GhostButton, PrimaryButton, SectionLabel, StatusBanner, TextField } from './ui';

interface PendingNomination {
  id: string;
  nominated_by: string;
  nominee_id: string;
  status: string;
  note: string | null;
  created_at: string;
  nominee?: { id: string; name: string; usn: string | null } | null;
  nominator?: { id: string; name: string } | null;
}

interface AuditRow {
  id: string;
  action: string;
  actor_name: string | null;
  target_name: string | null;
  outcome: string | null;
  detail: string | null;
  created_at: string;
}

export function AdminHandover() {
  const { profile } = useAuth();
  const admin = isAdmin(profile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nominees, setNominees] = useState<AdminNominee[]>([]);
  const [pending, setPending] = useState<PendingNomination | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (!profile || !isAdmin(profile)) return;
    setError(null);

    const [nomineeResult, pendingResult, auditResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, name, usn, designation, avatar_url')
        .eq('role', 'faculty')
        .in('faculty_status', ['approved', 'verified'])
        .eq('member_type', 'faculty')
        .neq('id', profile.id)
        .order('name'),
      supabase
        .from('admin_nominations')
        .select(
          '*, nominee:profiles!nominee_id (id, name, usn), nominator:profiles!nominated_by (id, name)'
        )
        .eq('status', 'pending')
        .maybeSingle(),
      supabase
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const loadError =
      nomineeResult.error?.message ||
      pendingResult.error?.message ||
      auditResult.error?.message ||
      null;
    if (loadError) setError(loadError);
    if (!nomineeResult.error) setNominees((nomineeResult.data ?? []) as AdminNominee[]);
    if (!pendingResult.error) {
      setPending((pendingResult.data ?? null) as PendingNomination | null);
    }
    if (!auditResult.error) setAudit((auditResult.data ?? []) as AuditRow[]);
    setLoading(false);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const nominate = useCallback(() => {
    if (busyRef.current) return;
    const nominee = nominees.find((row) => row.id === selectedId);
    if (!nominee) {
      setActionError('Choose an eligible faculty member.');
      return;
    }

    Alert.alert(
      'Nominate successor',
      `Nominate ${nominee.name} as administrator? They must accept before the role transfers.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Nominate',
          onPress: async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            setActionError(null);
            try {
              const { error: rpcError } = await supabase.rpc('nominate_admin', {
                p_nominee: nominee.id,
                p_note: note.trim() || null,
              });
              if (rpcError) {
                setActionError(rpcError.message);
                return;
              }
              setSelectedId('');
              setNote('');
              await load();
            } catch (err) {
              setActionError(
                err instanceof Error ? err.message : 'The nomination could not be created.'
              );
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [load, note, nominees, selectedId]);

  const cancel = useCallback(() => {
    if (busyRef.current || !pending) return;
    const nomineeName = pending.nominee?.name || 'this nominee';
    Alert.alert(
      'Cancel nomination',
      `Cancel the pending nomination for ${nomineeName}?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel nomination',
          style: 'destructive',
          onPress: async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            setActionError(null);
            try {
              const { error: rpcError } = await supabase.rpc('cancel_admin_nomination', {
                p_id: pending.id,
              });
              if (rpcError) {
                setActionError(rpcError.message);
                return;
              }
              await load();
            } catch (err) {
              setActionError(
                err instanceof Error ? err.message : 'The nomination could not be cancelled.'
              );
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [load, pending]);

  if (!admin) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.icon}>
          <Ionicons name="shield-checkmark-outline" size={18} color={Brand.accent} />
        </View>
        <View style={styles.headingText}>
          <Text style={styles.title}>Administrator handover</Text>
          <Text style={styles.copy}>
            The nominee must accept before the role transfers. If no administrator remains,
            operator recovery is required.
          </Text>
        </View>
      </View>

      {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}
      {actionError ? <StatusBanner kind="error">{actionError}</StatusBanner> : null}
      {loading ? <Text style={styles.muted}>Loading succession state…</Text> : null}

      {!loading && pending ? (
        <View style={styles.pending}>
          <View style={styles.pendingHeading}>
            <Ionicons name="time-outline" size={15} color={Brand.warning} />
            <Text style={styles.pendingName}>{pending.nominee?.name || 'Unknown nominee'}</Text>
            <Text style={styles.statusChip}>{nominationStatusLabel(pending.status)}</Text>
          </View>
          <Text style={styles.muted}>
            Nominated by {pending.nominator?.name || 'the current administrator'}{' '}
            {formatRelativeTime(pending.created_at)}
          </Text>
          {pending.note ? <Text style={styles.note}>{pending.note}</Text> : null}
          <View style={styles.actionRow}>
            <GhostButton
              label="Cancel nomination"
              icon="close-outline"
              onPress={cancel}
              disabled={busy}
            />
          </View>
        </View>
      ) : null}

      {!loading && !pending ? (
        <View style={styles.form}>
          <SectionLabel>Eligible nominee</SectionLabel>
          {nominees.length === 0 ? (
            <Text style={styles.muted}>No approved faculty are eligible yet.</Text>
          ) : (
            <View style={styles.nomineeList}>
              {nominees.map((nominee) => {
                const selected = selectedId === nominee.id;
                return (
                  <Pressable
                    key={nominee.id}
                    onPress={() => setSelectedId(nominee.id)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: busy }}
                    accessibilityLabel={`Nominate ${nominee.name}`}
                    style={({ pressed }) => [
                      styles.nomineeRow,
                      selected && styles.nomineeRowSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={selected ? Brand.accent : Brand.dim}
                    />
                    <View style={styles.nomineeText}>
                      <Text style={styles.nomineeName}>{nominee.name}</Text>
                      <Text style={styles.nomineeMeta} numberOfLines={1}>
                        {[nominee.designation, nominee.usn].filter(Boolean).join(' · ') ||
                          'Approved faculty'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          <TextField
            label="Optional note"
            value={note}
            onChangeText={setNote}
            maxLength={500}
            multiline
            editable={!busy}
            placeholder="Context for the nominee (max 500 characters)"
            hint={`${note.length}/500`}
          />

          <View style={styles.actionRow}>
            <PrimaryButton
              label="Nominate successor"
              icon="person-add-outline"
              onPress={nominate}
              busy={busy}
              disabled={busy || !selectedId}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.audit}>
        <SectionLabel>Recent succession activity</SectionLabel>
        {audit.length === 0 ? (
          <Text style={styles.muted}>No succession activity yet.</Text>
        ) : (
          audit.map((row) => (
            <View key={row.id} style={styles.auditRow}>
              <View style={styles.auditHeading}>
                <Text style={styles.auditAction}>{adminActionLabel(row.action)}</Text>
                {row.outcome ? <Text style={styles.statusChip}>{row.outcome}</Text> : null}
                <Text style={styles.auditTime}>{formatRelativeTime(row.created_at)}</Text>
              </View>
              <Text style={styles.auditMeta} numberOfLines={2}>
                {row.actor_name || 'System'} → {row.target_name || '—'}
              </Text>
              {row.detail ? (
                <Text style={styles.auditDetail} numberOfLines={3}>
                  {row.detail}
                </Text>
              ) : null}
            </View>
          ))
        )}
        <Text style={styles.footer}>
          Read-only audit. Recovery is operator-only and is not available from this app.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    padding: 15,
    gap: 13,
  },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
  },
  headingText: { flex: 1, minWidth: 0 },
  title: { fontFamily: Type.bodySemiBold, fontSize: 14, color: Brand.ink },
  copy: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.muted,
    marginTop: 3,
  },
  muted: { fontFamily: Type.body, fontSize: 12, lineHeight: 17, color: Brand.muted },
  form: { gap: 10 },
  nomineeList: { gap: 6 },
  nomineeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  nomineeRowSelected: {
    borderColor: `${Brand.accent}99`,
    backgroundColor: Brand.accentSoft,
  },
  nomineeText: { flex: 1, minWidth: 0 },
  nomineeName: { fontFamily: Type.bodyMedium, fontSize: 13, color: Brand.ink },
  nomineeMeta: { fontFamily: Type.body, fontSize: 11, color: Brand.dim, marginTop: 1 },
  pending: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.warning}66`,
    backgroundColor: 'rgba(240, 188, 105, 0.07)',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  pendingHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  pendingName: { fontFamily: Type.bodySemiBold, fontSize: 13.5, color: Brand.ink },
  statusChip: {
    fontFamily: Type.bodyMedium,
    fontSize: 10,
    color: Brand.muted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
    textTransform: 'capitalize',
  },
  note: {
    fontFamily: Type.body,
    fontSize: 12,
    lineHeight: 17,
    color: Brand.muted,
    fontStyle: 'italic',
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  audit: { gap: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Brand.line, paddingTop: 12 },
  auditRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  auditHeading: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  auditAction: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.ink,
    textTransform: 'capitalize',
  },
  auditTime: { fontFamily: Type.body, fontSize: 10, color: Brand.dim, marginLeft: 'auto' },
  auditMeta: { fontFamily: Type.body, fontSize: 11, color: Brand.muted },
  auditDetail: { fontFamily: Type.body, fontSize: 11, lineHeight: 15, color: Brand.dim },
  footer: { fontFamily: Type.body, fontSize: 10.5, color: Brand.dim, lineHeight: 15 },
  pressed: { opacity: 0.75 },
});
