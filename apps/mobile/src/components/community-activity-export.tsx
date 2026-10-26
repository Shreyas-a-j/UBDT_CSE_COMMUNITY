import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { exportCommunityActivityCsv } from '@/lib/community-export';
import { sixMonthWindowLabel } from '@/lib/community-export-format';
import { Brand, Type } from '@/lib/theme';
import { GhostButton, StatusBanner } from './ui';

/**
 * Download control for the website's six-month community activity CSV.
 *
 * Showing the control is only a convenience: the website route re-reads the
 * caller's profile on every request and rejects anyone who is not approved
 * faculty. The mobile app never relaxes that rule.
 */
export function CommunityActivityExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const download = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const file = await exportCommunityActivityCsv();
      setNotice(`CSV ready: ${file.filename}`);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'The export could not be completed. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.icon}>
          <Ionicons name="download-outline" size={18} color={Brand.accent} />
        </View>
        <View style={styles.headingText}>
          <Text style={styles.title}>Community activity export</Text>
          <Text style={styles.copy}>
            Events, project showcases and announcements from the trailing six calendar months, as a
            CSV. Available to approved faculty and admins.
          </Text>
          <Text style={styles.window}>{sixMonthWindowLabel()} · UTC, inclusive</Text>
          <Text style={styles.note}>
            The file includes start_date, end_date, exported_at and record types as manifest rows.
          </Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <GhostButton
          label={busy ? 'Preparing CSV…' : 'Download CSV'}
          icon="download-outline"
          onPress={() => void download()}
          disabled={busy}
        />
      </View>

      {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}
      {notice ? <StatusBanner kind="success">{notice}</StatusBanner> : null}
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
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
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
  headingText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Type.bodySemiBold,
    fontSize: 14,
    color: Brand.ink,
  },
  copy: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.muted,
    marginTop: 3,
  },
  window: {
    fontFamily: Type.body,
    fontSize: 11,
    color: Brand.dim,
    marginTop: 6,
  },
  note: {
    fontFamily: Type.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: Brand.dim,
    marginTop: 3,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
