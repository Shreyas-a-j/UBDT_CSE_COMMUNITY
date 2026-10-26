'use client';

/**
 * Admin review — mobile parity with `/admin`.
 *
 * The mobile app never reviews an application directly. It calls the existing
 * `/api/admin/faculty` and `/api/admin/faculty/[id]` routes with the signed-in
 * Supabase session; those routes re-read the caller's admin role and the
 * database RPC repeats the check. Hiding the screen would not be an
 * authorization boundary, so no decision is trusted from the client.
 */

import { useCallback, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { normalizeProfile, canExportCommunityActivity, isAdmin } from '@/lib/profile';
import { websiteJson, WebsiteApiError } from '@/lib/website-api';
import { Brand, Type } from '@/lib/theme';
import type { Profile } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { CommunityActivityExport } from '@/components/community-activity-export';
import { AdminHandover } from '@/components/admin-handover';
import { PageHeader, Screen } from '@/components/layout';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import {
  ActionButton,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  StatusBanner,
} from '@/components/ui';

type ApplicationStatus = 'pending' | 'approved' | 'rejected';

interface FacultyApplication {
  id: string;
  user_id: string;
  full_name: string;
  official_email: string;
  department: string;
  designation: string;
  employee_id: string | null;
  status: ApplicationStatus;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface AdminFacultyPayload {
  applications?: FacultyApplication[];
  profiles?: Record<string, unknown>[];
  emailVerified?: Record<string, boolean>;
  emailVerificationError?: string | null;
  error?: string;
}

function applicationStatus(value: unknown): ApplicationStatus {
  return value === 'approved' || value === 'rejected' ? value : 'pending';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function VerificationBadge({ verified }: { verified: boolean | undefined }) {
  if (verified === true) return <Badge label="Email verified" tone="good" />;
  if (verified === false) return <Badge label="Email not verified" tone="warn" />;
  return null;
}

export default function AdminReviewScreen() {
  const { profile, loading: authLoading } = useAuth();
  const admin = isAdmin(profile);

  const [applications, setApplications] = useState<FacultyApplication[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [emailVerified, setEmailVerified] = useState<Record<string, boolean>>({});
  const [emailVerificationError, setEmailVerificationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const processingRef = useRef<Set<string>>(new Set());

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      if (!admin) {
        setLoading(false);
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else if (mode === 'initial') setLoading(true);
      setError(null);

      try {
        const payload = await websiteJson<AdminFacultyPayload>('/api/admin/faculty', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        setApplications(
          (payload.applications ?? []).map((application) => ({
            ...application,
            status: applicationStatus(application.status),
          }))
        );

        const profileMap: Record<string, Profile> = {};
        for (const row of payload.profiles ?? []) {
          const normalized = normalizeProfile(row);
          if (normalized) profileMap[normalized.id] = normalized;
        }
        setProfiles(profileMap);
        setEmailVerified(payload.emailVerified ?? {});
        setEmailVerificationError(payload.emailVerificationError ?? null);
      } catch (loadError) {
        if (loadError instanceof WebsiteApiError && loadError.status === 403) {
          setError('Administrator access is required to review faculty applications.');
        } else {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load faculty applications.'
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [admin]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const decide = useCallback(
    async (application: FacultyApplication, decision: 'approve' | 'reject') => {
      if (processingRef.current.has(application.id)) return;
      processingRef.current.add(application.id);
      setProcessingId(application.id);
      setActionError(null);

      try {
        await websiteJson<{ status?: string }>(
          `/api/admin/faculty/${encodeURIComponent(application.id)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              decision,
              notes: decision === 'reject' ? 'Application not approved' : null,
            }),
          }
        );

        setApplications((previous) =>
          previous.map((row) =>
            row.id === application.id
              ? {
                  ...row,
                  status: decision === 'approve' ? 'approved' : 'rejected',
                  reviewed_at: new Date().toISOString(),
                }
              : row
          )
        );
        await load('silent');
      } catch (decisionError) {
        setActionError(
          decisionError instanceof Error
            ? decisionError.message
            : 'The review could not be completed.'
        );
        await load('silent');
      } finally {
        processingRef.current.delete(application.id);
        setProcessingId(null);
      }
    },
    [load]
  );

  const confirmApprove = useCallback(
    (application: FacultyApplication) => {
      Alert.alert(
        'Approve faculty application',
        `Grant faculty access to ${application.full_name}? They will be able to publish announcements and host faculty content immediately.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Approve',
            onPress: () => void decide(application, 'approve'),
          },
        ]
      );
    },
    [decide]
  );

  const confirmReject = useCallback(
    (application: FacultyApplication) => {
      Alert.alert(
        'Reject faculty application',
        `Reject ${application.full_name}'s application? The recorded note will be “Application not approved”.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reject',
            style: 'destructive',
            onPress: () => void decide(application, 'reject'),
          },
        ]
      );
    },
    [decide]
  );

  if (authLoading) {
    return (
      <Screen>
        <PageHeader eyebrow="Administration" title="Faculty applications" subtitle="Loading review queue…" />
        <View style={styles.loadingWrap}>
          <ListSkeleton count={3} />
        </View>
      </Screen>
    );
  }

  if (!admin) {
    return (
      <Screen>
        <PageHeader eyebrow="Administration" title="Faculty applications" subtitle="Admin access required" />
        <EmptyState
          icon="shield-outline"
          title="Access denied"
          message="Admin privileges are required to review faculty applications."
          action={<GhostButton label="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const pending = applications.filter((application) => application.status === 'pending');
  const reviewed = applications.filter((application) => application.status !== 'pending');
  const approvedCount = applications.filter((application) => application.status === 'approved').length;
  const rejectedCount = applications.filter((application) => application.status === 'rejected').length;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
      >
        <PageHeader
          eyebrow="Administration"
          title="Faculty applications"
          subtitle="Review requests for faculty access. Approving grants verified publishing permissions immediately."
          right={
            <ActionButton
              label="Refresh"
              icon="refresh"
              onPress={() => void load('refresh')}
              busy={refreshing}
            />
          }
        />

        {error ? (
          <StatusBanner kind="error">{error}</StatusBanner>
        ) : null}

        {emailVerificationError && !loading ? (
          <StatusBanner kind="warning">
            Email verification status is unavailable. Applications remain reviewable. ({emailVerificationError})
          </StatusBanner>
        ) : null}

        {canExportCommunityActivity(profile) ? <CommunityActivityExport /> : null}

        <AdminHandover />

        <View style={styles.stats}>
          <Stat label="Pending" value={pending.length} tone={Brand.warning} />
          <Stat label="Approved" value={approvedCount} tone={Brand.success} />
          <Stat label="Rejected" value={rejectedCount} tone={Brand.error} />
        </View>

        {actionError ? <StatusBanner kind="error">{actionError}</StatusBanner> : null}

        {loading ? (
          <ListSkeleton count={3} />
        ) : error ? (
          <ErrorState
            title="Applications unavailable"
            message={error}
            onRetry={() => void load()}
            retrying={refreshing}
          />
        ) : (
          <>
            <View style={styles.section}>
              <SectionLabel>Awaiting review</SectionLabel>
              {pending.length === 0 ? (
                <EmptyState
                  icon={applications.length === 0 ? 'documents-outline' : 'checkmark-circle-outline'}
                  title={applications.length === 0 ? 'No applications yet' : 'Nothing to review'}
                  message={
                    applications.length === 0
                      ? 'New faculty signups will appear here automatically.'
                      : 'All faculty applications have been processed.'
                  }
                />
              ) : (
                <View style={styles.list}>
                  {pending.map((application) => {
                    const applicant = profiles[application.user_id];
                    const busy = processingId === application.id;
                    return (
                      <View key={application.id} style={styles.applicationCard}>
                        <View style={styles.identityRow}>
                          <Avatar
                            name={applicant?.name ?? application.full_name}
                            uri={applicant?.avatar_url}
                            size={46}
                          />
                          <View style={styles.identityText}>
                            <Text style={styles.name}>{application.full_name}</Text>
                            <Text style={styles.roleLine}>
                              {[application.designation, application.department]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.facts}>
                          <Fact icon="mail-outline" text={application.official_email} />
                          {application.employee_id ? (
                            <Fact icon="id-card-outline" text={`Employee ID ${application.employee_id}`} />
                          ) : null}
                          <Fact
                            icon="calendar-outline"
                            text={`Applied ${formatDate(application.created_at)}`}
                          />
                        </View>

                        <VerificationBadge verified={emailVerified[application.user_id]} />

                        <View style={styles.decideRow}>
                          <View style={styles.decideButton}>
                            <PrimaryButton
                              label={busy ? 'Saving…' : 'Approve'}
                              icon="checkmark-circle-outline"
                              onPress={() => confirmApprove(application)}
                              busy={busy}
                              disabled={Boolean(processingId)}
                            />
                          </View>
                          <View style={styles.decideButton}>
                            <GhostButton
                              label="Reject"
                              icon="close-circle-outline"
                              onPress={() => confirmReject(application)}
                              disabled={Boolean(processingId)}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {reviewed.length > 0 ? (
              <View style={styles.section}>
                <SectionLabel>Recent reviews</SectionLabel>
                <View style={styles.reviewedList}>
                  {reviewed.slice(0, 8).map((application) => (
                    <View key={application.id} style={styles.reviewedRow}>
                      <View style={styles.reviewedText}>
                        <Text style={styles.reviewedName} numberOfLines={1}>
                          {application.full_name}
                        </Text>
                        <Text style={styles.reviewedMeta} numberOfLines={1}>
                          {application.designation} · Reviewed{' '}
                          {formatDate(application.reviewed_at || application.created_at)}
                        </Text>
                      </View>
                      <View style={styles.reviewedBadges}>
                        <VerificationBadge verified={emailVerified[application.user_id]} />
                        <Badge
                          label={application.status}
                          tone={application.status === 'approved' ? 'good' : 'error'}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}

        <Text style={styles.footer}>
          Decisions are sent to the website admin API, which re-checks your role and uses the
          database review RPC. The app cannot approve itself.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Fact({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={13} color={Brand.dim} />
      <Text style={styles.factText} selectable>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 36,
    gap: 15,
  },
  loadingWrap: {
    paddingHorizontal: 18,
  },
  stats: {
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 18,
  },
  stat: {
    flex: 1,
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Type.displayBold,
    fontSize: 26,
    lineHeight: 30,
  },
  statLabel: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
    marginTop: 3,
  },
  section: {
    paddingHorizontal: 18,
    marginTop: 4,
  },
  list: {
    gap: 11,
    marginTop: 9,
  },
  applicationCard: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    padding: 14,
    gap: 11,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Type.bodySemiBold,
    fontSize: 15,
    color: Brand.ink,
  },
  roleLine: {
    fontFamily: Type.body,
    fontSize: 12,
    color: Brand.warning,
    marginTop: 2,
  },
  facts: {
    gap: 4,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  factText: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 11,
    lineHeight: 16,
    color: Brand.dim,
  },
  decideRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  decideButton: {
    flex: 1,
  },
  reviewedList: {
    marginTop: 9,
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    overflow: 'hidden',
  },
  reviewedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Brand.line,
  },
  reviewedText: {
    flex: 1,
    minWidth: 0,
  },
  reviewedName: {
    fontFamily: Type.bodyMedium,
    fontSize: 13,
    color: Brand.ink,
  },
  reviewedMeta: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
    marginTop: 2,
  },
  reviewedBadges: {
    alignItems: 'flex-end',
    gap: 5,
  },
  footer: {
    fontFamily: Type.body,
    fontSize: 10.5,
    lineHeight: 16,
    color: Brand.dim,
    textAlign: 'center',
    paddingHorizontal: 28,
  },
});
