'use client';

/**
 * Native update dialog.
 *
 * This is a presentation component; the gate owns session policy and the
 * native download hand-off. Mandatory updates deliberately have no backdrop
 * dismissal and no Later action until the browser hand-off has happened.
 */

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostButton, PrimaryButton, StatusBanner } from '@/components/ui';
import type { AvailableUpdate, UpdatePromptPhase } from '@/lib/app-update';
import { Brand, Radius, Type } from '@/lib/theme';

interface AppUpdateDialogProps {
  update: AvailableUpdate;
  phase: UpdatePromptPhase;
  error: string | null;
  onUpdate: () => void;
  onLater: () => void;
  onContinue: () => void;
  onRequestClose: () => void;
}

export function AppUpdateDialog({
  update,
  phase,
  error,
  onUpdate,
  onLater,
  onContinue,
  onRequestClose,
}: AppUpdateDialogProps) {
  const insets = useSafeAreaInsets();
  const mandatory = update.manifest.mandatory;
  const opening = phase === 'opening';
  const opened = phase === 'opened';
  const canDismiss = !opening && (!mandatory || opened);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
    >
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        {canDismiss ? (
          <Pressable
            style={styles.backdrop}
            onPress={onRequestClose}
            accessible={false}
          />
        ) : (
          <View style={styles.backdrop} />
        )}

        <View
          style={styles.card}
          accessibilityViewIsModal
          accessibilityLiveRegion="polite"
        >
          <View style={styles.heading}>
            <View style={styles.icon}>
              <Ionicons
                name="cloud-download-outline"
                size={22}
                color={Brand.accent}
              />
            </View>
            <View style={styles.headingText}>
              <Text style={styles.title} accessibilityRole="header">
                A new version of UCC is available
              </Text>
              <View
                style={[
                  styles.badge,
                  mandatory ? styles.badgeRequired : styles.badgeOptional,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    { color: mandatory ? Brand.warning : Brand.accent },
                  ]}
                >
                  {mandatory ? 'Required update' : 'Optional update'}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.lede}>
            {mandatory
              ? 'Install this update to keep using UCC. UCC stays open until the download has started.'
              : 'A newer UCC build is ready. You can install it now or keep using this version for now.'}
          </Text>

          <View style={styles.versionCard}>
            <View style={styles.versionBlock}>
              <Text style={styles.versionLabel}>Installed</Text>
              <Text style={styles.versionValue} numberOfLines={1}>
                {update.installed.version}
              </Text>
              <Text style={styles.versionMeta}>
                Build {update.installed.versionCode}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={Brand.dim} />
            <View style={styles.versionBlock}>
              <Text style={styles.versionLabel}>Latest</Text>
              <Text
                style={[styles.versionValue, styles.versionLatest]}
                numberOfLines={1}
              >
                {update.manifest.version}
              </Text>
              <Text style={styles.versionMeta}>
                Build {update.manifest.versionCode}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>What&apos;s new</Text>
          <ScrollView
            style={styles.notes}
            contentContainerStyle={styles.notesContent}
            showsVerticalScrollIndicator={false}
          >
            {update.manifest.releaseNotes.map((note, index) => (
              <View style={styles.noteRow} key={`${index}-${note}`}>
                <View style={styles.bullet} />
                <Text style={styles.note}>{note}</Text>
              </View>
            ))}
          </ScrollView>

          {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}

          {opened ? (
            <StatusBanner kind="info">
              Your browser is downloading UCC. Finish the download, open the
              APK, and approve installation there.
            </StatusBanner>
          ) : null}

          {mandatory && !opened ? (
            <StatusBanner kind="warning">
              This update is required. The dialog unlocks once the download has
              started.
            </StatusBanner>
          ) : null}

          <View style={styles.actions}>
            <View style={styles.primaryAction}>
              <PrimaryButton
                label={
                  opened
                    ? mandatory
                      ? 'Continue to UCC'
                      : 'Download again'
                    : 'Update now'
                }
                icon={
                  opened && mandatory ? 'checkmark-outline' : 'download-outline'
                }
                onPress={opened && mandatory ? onContinue : onUpdate}
                busy={opening}
                disabled={opening}
              />
            </View>
            {opened && mandatory ? (
              <GhostButton
                label="Download again"
                icon="download-outline"
                onPress={onUpdate}
                disabled={opening}
              />
            ) : null}
            {!mandatory ? (
              <GhostButton
                label="Later"
                onPress={onLater}
                disabled={opening}
              />
            ) : null}
          </View>

          <View style={styles.footnote}>
            <Ionicons
              name="shield-checkmark-outline"
              size={15}
              color={Brand.dim}
            />
            <Text style={styles.footnoteText}>
              Android may ask you to allow installs from your browser and to
              approve the update. UCC cannot install it for you.
            </Text>
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
    paddingHorizontal: 20,
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
    maxWidth: 440,
    maxHeight: '88%',
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
    backgroundColor: Brand.surface,
    padding: 20,
    gap: 13,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
  },
  headingText: {
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  title: {
    fontFamily: Type.display,
    fontSize: 19,
    lineHeight: 24,
    color: Brand.ink,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeRequired: {
    borderColor: `${Brand.warning}66`,
    backgroundColor: 'rgba(240, 188, 105, 0.10)',
  },
  badgeOptional: {
    borderColor: `${Brand.accent}66`,
    backgroundColor: Brand.accentSoft,
  },
  badgeText: {
    fontFamily: Type.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  lede: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.muted,
  },
  versionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  versionBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  versionLabel: {
    fontFamily: Type.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  versionValue: {
    fontFamily: Type.display,
    fontSize: 17,
    color: Brand.ink,
    fontVariant: ['tabular-nums'],
  },
  versionLatest: {
    color: Brand.accentHover,
  },
  versionMeta: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
    fontVariant: ['tabular-nums'],
  },
  sectionLabel: {
    fontFamily: Type.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: Brand.dim,
    marginTop: 1,
  },
  notes: {
    flexShrink: 1,
    maxHeight: 170,
    marginTop: -5,
  },
  notesContent: {
    gap: 7,
    paddingBottom: 2,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Brand.accent,
    marginTop: 7,
  },
  note: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.ink,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  primaryAction: {
    flex: 1,
  },
  footnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingTop: 1,
  },
  footnoteText: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: Brand.dim,
  },
});
