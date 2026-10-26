'use client';

/**
 * Public member profile — mobile equivalent of the website's
 * `/people/[id]` page.
 *
 * Reads the same `profiles` row and the member's most recent showcases.
 * Email, verification status and private relationship data are not shown;
 * the email-verification badge is deferred until its RPC is available.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { POST_SELECT, getYearLabel, mapPost } from '@/lib/community';
import { normalizeProfile } from '@/lib/profile';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Radius, Type } from '@/lib/theme';
import type { Post, Profile } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { BackHeader, Screen } from '@/components/layout';
import { PostCard } from '@/components/post-card';
import { ProfileLinks } from '@/components/profile-links';
import { RowSkeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/states';import { ChipRow, SectionLabel } from '@/components/ui';

function formatJoined(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (!id) {
        setError('This profile could not be found.');
        setLoading(false);
        return;
      }
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const profileResult = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (profileResult.error) {
        logSupabaseError('Public profile error', profileResult.error);
        setError(profileResult.error.message || 'This profile could not be loaded.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const normalized = normalizeProfile(
        profileResult.data as Record<string, unknown> | null
      );
      if (!normalized) {
        setProfile(null);
        setError('This member could not be found. They may have left the community.');
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setProfile(normalized);

      let projectsResult = await supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('author_id', id)
        .eq('type', 'showcase')
        .order('created_at', { ascending: false })
        .limit(40);

      if (projectsResult.error) {
        projectsResult = await supabase
          .from('posts')
          .select('*')
          .eq('author_id', id)
          .eq('type', 'showcase')
          .order('created_at', { ascending: false })
          .limit(40);
      }

      if (projectsResult.error) {
        logSupabaseError('Public profile projects error', projectsResult.error);
        setProjectsError(projectsResult.error.message || 'Projects could not be loaded.');
        setProjects([]);
      } else {
        setProjectsError(null);
        setProjects(
          ((projectsResult.data ?? []) as unknown as Record<string, unknown>[]).map(mapPost)
        );
      }

      setLoading(false);
      setRefreshing(false);
    },
    [id]
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <BackHeader title="Profile" subtitle="Loading member" />
        <View style={styles.loadingWrap}>
          <RowSkeleton count={5} />
        </View>
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen>
        <BackHeader title="Profile" />
        <ErrorState
          title="Profile unavailable"
          message={error ?? 'This member could not be found.'}
          onRetry={() => void load()}
        />
      </Screen>
    );
  }

  const isSelf = profile.id === userId;
  const identityChips = [
    profile.usn ?? null,
    profile.member_type === 'alumni'
      ? profile.graduation_year
        ? `Class of ${profile.graduation_year}`
        : 'Alumni'
      : getYearLabel(profile.year),
    profile.section ? `Section ${profile.section}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <Screen>
      <BackHeader title="Member profile" subtitle={profile.branch} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
      >
        <View style={styles.hero}>
          <View style={styles.heroBanner}>
            <Text style={styles.heroGlyph}>&lt;/&gt;</Text>
          </View>
          <View style={styles.heroBody}>
            <View style={styles.avatarRow}>
              <View style={styles.avatarRing}>
                <Avatar name={profile.name} uri={profile.avatar_url} size={76} />
              </View>
              {isSelf ? <Badge label="This is you" tone="accent" /> : null}
            </View>

            <Text style={styles.name}>{profile.name}</Text>

            <View style={styles.badges}>
              {identityChips.map((chip) => (
                <Badge key={chip} label={chip} />
              ))}
              {profile.role === 'faculty' ? <Badge label="Faculty" tone="warn" /> : null}
              {profile.role === 'admin' ? <Badge label="Admin" tone="warn" /> : null}
              {profile.member_type === 'alumni' && profile.graduation_year ? (
                <Badge
                  label={`Alumni '${String(profile.graduation_year).slice(-2)}`}
                  tone="warn"
                />
              ) : null}
            </View>
          </View>
        </View>

        <Section title="About">
          {profile.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : (
            <Text style={styles.emptyCopy}>{profile.name} hasn’t added a bio yet.</Text>
          )}
          <ProfileLinks profile={profile} />
        </Section>

        <Section title="Skills">
          {profile.skills.length > 0 ? (
            <ChipRow values={profile.skills} />
          ) : (
            <Text style={styles.emptyCopy}>No skills listed.</Text>
          )}
        </Section>

        <Section title="Interests">
          {profile.interests.length > 0 ? (
            <ChipRow values={profile.interests} tone="accent" />
          ) : (
            <Text style={styles.emptyCopy}>No interests listed.</Text>
          )}
        </Section>

        <Section title="Details">
          <View style={styles.detailList}>
            <DetailRow icon="school-outline" label="Department" value={profile.branch || 'CSE'} />
            <DetailRow
              icon="calendar-outline"
              label="Joined"
              value={formatJoined(profile.created_at)}
            />
            {profile.designation ? (
              <DetailRow
                icon="briefcase-outline"
                label="Designation"
                value={profile.designation}
              />
            ) : null}
          </View>
        </Section>

        <Section title="Projects" count={projects.length > 0 ? projects.length : undefined}>
          {projectsError ? (
            <Text style={styles.warningCopy}>
              Projects could not be loaded. Check your connection and refresh.
            </Text>
          ) : projects.length > 0 ? (
            <View style={styles.projects}>
              {projects.map((project) => (
                <PostCard
                  key={project.id}
                  post={project}
                  onPress={() =>
                    router.push({ pathname: '/post/[id]', params: { id: project.id } })
                  }
                />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyCopy}>
              No project showcases yet. Students can share projects from the feed.
            </Text>
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <SectionLabel trailing={count ? <Text style={styles.count}>{count}</Text> : undefined}>
        {title}
      </SectionLabel>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={16} color={Brand.dim} />
      <View style={styles.detailText}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 34,
  },
  hero: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
    overflow: 'hidden',
  },
  heroBanner: {
    height: 84,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Brand.line,
    backgroundColor: '#191A2B',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 10,
  },
  heroGlyph: {
    fontFamily: Type.displayBold,
    fontSize: 62,
    color: 'rgba(255,255,255,0.04)',
  },
  heroBody: {
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: -38,
  },
  avatarRing: {
    borderRadius: 42,
    borderWidth: 3,
    borderColor: Brand.surface,
  },
  name: {
    fontFamily: Type.displayBold,
    fontSize: 25,
    lineHeight: 31,
    color: Brand.ink,
    marginTop: 14,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
  },
  section: {
    marginTop: 22,
  },
  sectionBody: {
    marginTop: 10,
    gap: 12,
  },
  bio: {
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 21,
    color: Brand.muted,
  },
  emptyCopy: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Brand.dim,
  },
  warningCopy: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Brand.error,
  },
  detailList: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
    padding: 14,
    gap: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  detailText: {
    flex: 1,
    minWidth: 0,
  },
  detailLabel: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
  },
  detailValue: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
    color: Brand.muted,
    marginTop: 2,
  },
  projects: {
    gap: 12,
  },
  count: {
    fontFamily: Type.bodyMedium,
    fontSize: 10.5,
    color: Brand.dim,
    backgroundColor: Brand.elevated,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
