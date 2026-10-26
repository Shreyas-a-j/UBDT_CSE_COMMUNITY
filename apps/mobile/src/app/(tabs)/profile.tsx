'use client';

/**
 * Profile tab — the signed-in member's real `public.profiles` row plus live
 * counts from `posts` and `event_rsvps`.
 *
 * Editing uses the same allowlisted columns as the website's ProfileModal.
 * Avatar changes remain on the website because the R2 upload route is bound
 * to the website session and server secret.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { canPublishFacultyContent, displayName, firstName, isAdmin } from '@/lib/profile';
import { getYearLabel } from '@/lib/community';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Radius, Type } from '@/lib/theme';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { PageHeader, Screen } from '@/components/layout';
import { ProfileLinks } from '@/components/profile-links';
import { EmptyState, ErrorState } from '@/components/states';
import {
  ActionButton,
  ChipRow,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  StatusBanner,
} from '@/components/ui';

interface Counts {
  posts: number;
  events: number;
}

const EMPTY_COUNTS: Counts = { posts: 0, events: 0 };

export default function ProfileScreen() {
  const { session, profile, error: authError, signOut, refreshProfile } = useAuth();
  const userId = session?.user.id ?? null;

  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadCounts = useCallback(async () => {
    if (!userId) {
      if (mounted.current) {
        setCounts(EMPTY_COUNTS);
        setLoadingCounts(false);
      }
      return;
    }

    const [posts, events] = await Promise.all([
      supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', userId),
      supabase
        .from('event_rsvps')
        .select('event_id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    if (!mounted.current) return;

    const failure = posts.error ?? events.error;
    if (failure) {
      logSupabaseError('Profile counts error', failure);
      setCountsError(failure.message || 'Your activity counts could not be loaded.');
    } else {
      setCountsError(null);
    }

    setCounts({
      posts: posts.count ?? 0,
      events: events.count ?? 0,
    });
    setLoadingCounts(false);
  }, [userId]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshProfile(), loadCounts()]);
    if (mounted.current) setRefreshing(false);
  }, [loadCounts, refreshProfile]);

  const confirmSignOut = useCallback(() => {
    Alert.alert('Sign out of UCC?', 'You will need your community account to sign back in on this device.', [
      { text: 'Stay signed in', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          void signOut().finally(() => {
            if (mounted.current) setSigningOut(false);
          });
        },
      },
    ]);
  }, [signOut]);

  if (!profile) {
    return (
      <Screen>
        <PageHeader eyebrow="Account" title="Profile" subtitle="Your community identity." />
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={Brand.accent}
              colors={[Brand.accent]}
              progressBackgroundColor={Brand.surface}
            />
          }
        >
          {authError ? (
            <ErrorState
              title="Profile unavailable"
              message={authError}
              onRetry={() => void refresh()}
              retrying={refreshing}
            />
          ) : (
            <EmptyState
              icon="person-circle-outline"
              title="Profile not ready"
              message="Your account is signed in, but its community profile could not be read. Tap retry to fetch it again."
              action={<PrimaryButton label="Try again" onPress={() => void refresh()} busy={refreshing} />}
            />
          )}
        </ScrollView>
      </Screen>
    );
  }

  const facts = [
    profile.usn ? `USN ${profile.usn}` : null,
    profile.member_type === 'alumni'
      ? profile.graduation_year
        ? `Class of ${profile.graduation_year}`
        : 'Alumni'
      : profile.year
        ? getYearLabel(profile.year)
        : null,
    profile.branch,
    profile.section ? `Section ${profile.section}` : null,
  ].filter((value): value is string => Boolean(value));

  const email = profile.email ?? session?.user.email ?? null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
      >
        <PageHeader
          eyebrow="Account"
          title={firstName(profile.name)}
          subtitle="Your community profile, activity and account controls."
          right={<ActionButton label="Refresh" icon="refresh" onPress={() => void refresh()} busy={refreshing} />}
        />

        <View style={styles.profileActions}>
          <ActionButton
            label="Edit profile"
            icon="create-outline"
            tone="accent"
            onPress={() => router.push('/profile/edit')}
          />
          <ActionButton
            label="View public profile"
            icon="person-outline"
            onPress={() =>
              router.push({ pathname: '/people/[id]', params: { id: profile.id } })
            }
          />
        </View>

        <View style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar name={profile.name} uri={profile.avatar_url} size={72} />
            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={2}>
                {displayName(profile)}
              </Text>
              {email ? (
                <Text style={styles.email} numberOfLines={1}>
                  {email}
                </Text>
              ) : null}
              <View style={styles.badgeRow}>
                <Badge label={profile.role} tone={profile.role === 'student' ? 'plain' : 'accent'} />
                {profile.faculty_status !== 'none' ? (
                  <Badge
                    label={`Faculty ${profile.faculty_status}`}
                    tone={
                      profile.faculty_status === 'approved' ||
                      profile.faculty_status === 'verified'
                        ? 'good'
                        : 'warn'
                    }
                  />
                ) : null}
                {canPublishFacultyContent(profile) && profile.designation ? (
                  <Badge label={profile.designation} />
                ) : null}
              </View>
            </View>
          </View>

          {facts.length > 0 ? (
            <View style={styles.facts}>
              <ChipRow values={facts} />
            </View>
          ) : null}

          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          <ProfileLinks profile={profile} />

          <View style={styles.stats}>
            <Stat label="Posts" value={counts.posts} loading={loadingCounts} onPress={() => router.navigate('/')} />
            <View style={styles.statDivider} />
            <Stat
              label="Events"
              value={counts.events}
              loading={loadingCounts}
              onPress={() => router.navigate('/events')}
            />
          </View>

          {countsError ? <StatusBanner kind="warning">{countsError}</StatusBanner> : null}
        </View>

        {profile.skills.length > 0 ? (
          <Section title="Skills">
            <ChipRow values={profile.skills} />
          </Section>
        ) : null}

        {profile.interests.length > 0 ? (
          <Section title="Interests">
            <ChipRow values={profile.interests} />
          </Section>
        ) : null}

        {profile.expertise.length > 0 ? (
          <Section title="Expertise">
            <ChipRow values={profile.expertise} />
          </Section>
        ) : null}

        <Section title="Community">
          <View style={styles.linkList}>
            <LinkRow
              icon="people-outline"
              title="Find people"
              detail="Browse every student, alumnus and faculty member"
              onPress={() => router.push('/people')}
            />
            {canPublishFacultyContent(profile) ? (
              <LinkRow
                icon="school-outline"
                title="Faculty workspace"
                detail="Announcements, events and the community CSV export"
                onPress={() => router.push('/faculty/dashboard')}
              />
            ) : null}
            {isAdmin(profile) ? (
              <LinkRow
                icon="shield-checkmark-outline"
                title="Admin review"
                detail="Review faculty applications"
                onPress={() => router.push('/admin')}
              />
            ) : null}
            <LinkRow
              icon="notifications-outline"
              title="Notifications"
              detail="Replies, reactions and updates"
              onPress={() => router.navigate('/notifications')}
            />
            <LinkRow
              icon="calendar-outline"
              title="Events"
              detail="Workshops and project sessions"
              onPress={() => router.navigate('/events')}
            />
          </View>
        </Section>

        <Section title="Account">
          {authError ? (
            <View style={styles.sessionNotice}>
              <StatusBanner kind="warning">{authError}</StatusBanner>
            </View>
          ) : null}
          <Text style={styles.accountCopy}>
            Profile details use the same community account as the website. Avatar changes stay on
            the website; signing out removes this device’s saved session while your posts, projects
            and event history stay in the community.
          </Text>
          <View style={styles.signOutRow}>
            <GhostButton
              label={signingOut ? 'Signing out…' : 'Sign out'}
              icon="log-out-outline"
              onPress={confirmSignOut}
              disabled={signingOut}
            />
          </View>
        </Section>
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label,
  value,
  loading,
  onPress,
}: {
  label: string;
  value: number;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${loading ? 'loading' : value}`}
      style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
    >
      <Text style={styles.statValue}>{loading ? '—' : value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionLabel>{title}</SectionLabel>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function LinkRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
    >
      <View style={styles.linkIcon}>
        <Ionicons name={icon} size={18} color={Brand.accent} />
      </View>
      <View style={styles.linkText}>
        <Text style={styles.linkTitle}>{title}</Text>
        <Text style={styles.linkDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Brand.dim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 34,
    flexGrow: 1,
  },
  profileActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 12,
  },
  card: {
    marginHorizontal: 18,
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 18,
    gap: 14,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Type.display,
    fontSize: 21,
    lineHeight: 26,
    color: Brand.ink,
  },
  email: {
    fontFamily: Type.body,
    fontSize: 12.5,
    color: Brand.dim,
    marginTop: 3,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
  },
  facts: {
    marginTop: -2,
  },
  bio: {
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Brand.muted,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: Radius.md,
  },
  statValue: {
    fontFamily: Type.displayBold,
    fontSize: 22,
    color: Brand.ink,
  },
  statLabel: {
    fontFamily: Type.body,
    fontSize: 11,
    color: Brand.dim,
    marginTop: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Brand.line,
    marginVertical: 3,
  },
  section: {
    marginTop: 22,
    paddingHorizontal: 18,
  },
  sectionBody: {
    marginTop: 10,
  },
  linkList: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Brand.line,
  },
  linkIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}44`,
  },
  linkText: {
    flex: 1,
    minWidth: 0,
  },
  linkTitle: {
    fontFamily: Type.bodyMedium,
    fontSize: 13.5,
    color: Brand.ink,
  },
  linkDetail: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    marginTop: 2,
  },
  accountCopy: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Brand.dim,
  },
  sessionNotice: {
    marginBottom: 10,
  },
  signOutRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  pressed: {
    opacity: 0.7,
  },
});
