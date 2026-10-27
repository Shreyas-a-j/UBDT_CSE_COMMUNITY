'use client';

/**
 * People directory — the mobile equivalent of the website's `/people`.
 *
 * Reads the same `public.profiles` projection (with the website's fallback for
 * older schemas), keeps the server's `created_at desc` order, excludes the
 * viewer, and applies identical filters:
 *   - search only name / USN / bio
 *   - a separate skill control matching skills or interests
 *   - the same approval-gated faculty / alumni / year directory filter
 *
 * This is a directory and profile surface only. There are no connection or
 * messaging actions; the website has no such routes either.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { alumniTag, isApprovedFaculty, normalizeProfile } from '@/lib/profile';
import {
  DIRECTORY_FILTERS,
  PEOPLE_COLUMNS,
  PEOPLE_FALLBACK_COLUMNS,
  filterPeople,
  type DirectoryFilter,
} from '@/lib/directory';
import { getYearLabel } from '@/lib/community';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { Profile } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { PageHeader, Screen } from '@/components/layout';
import { FilterChips } from '@/components/segmented';
import { RowSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { ActionButton, ChipRow, StatusBanner } from '@/components/ui';

function mapPeople(rows: unknown[] | null): Profile[] {
  return (rows ?? [])
    .map((row) => normalizeProfile(row as Record<string, unknown>))
    .filter((row): row is Profile => row !== null);
}

export default function PeopleScreen() {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;

  const [people, setPeople] = useState<Profile[]>([]);
  const [query, setQuery] = useState('');
  const [skill, setSkill] = useState('');
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    // The website selects explicit public columns and falls back when the
    // deployment predates member_type / graduation_year. Never select `*`.
    const primary = await supabase
      .from('profiles')
      .select(PEOPLE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(500);

    const result = primary.error
      ? await supabase
          .from('profiles')
          .select(PEOPLE_FALLBACK_COLUMNS)
          .order('created_at', { ascending: false })
          .limit(500)
      : primary;

    if (!mounted.current) return;

    if (result.error) {
      logSupabaseError('People directory error', result.error);
      setError(result.error.message || 'The people directory could not be loaded.');
      setPeople([]);
    } else {
      setPeople(mapPeople(result.data as unknown[] | null));
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      filterPeople(people, {
        query,
        skill,
        directoryFilter,
        viewerId,
      }),
    [directoryFilter, people, query, skill, viewerId]
  );

  const hasFilters = query.trim().length > 0 || skill.trim().length > 0 || directoryFilter !== 'all';
  const clearFilters = useCallback(() => {
    setQuery('');
    setSkill('');
    setDirectoryFilter('all');
  }, []);

  const header = (
    <View>
      <PageHeader
        eyebrow="Community directory"
        title="People"
        subtitle="Search students, alumni and faculty across all CSE batches by name, USN, skill or interest."
      />

      <View style={styles.filterCard}>
        <View style={styles.inputRow}>
          <Ionicons name="search" size={17} color={Brand.dim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, USN or bio"
            placeholderTextColor={Brand.dim}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            selectionColor={Brand.accent}
            underlineColorAndroid="transparent"
            accessibilityLabel="Search members"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
              style={styles.clearHit}
            >
              <Ionicons name="close-circle" size={17} color={Brand.dim} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.inputDivider} />

        <View style={styles.inputRow}>
          <Ionicons name="options-outline" size={17} color={Brand.dim} />
          <TextInput
            value={skill}
            onChangeText={setSkill}
            placeholder="Filter by skill or interest"
            placeholderTextColor={Brand.dim}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            selectionColor={Brand.accent}
            underlineColorAndroid="transparent"
            accessibilityLabel="Filter by skill or interest"
          />
          {skill.length > 0 ? (
            <Pressable
              onPress={() => setSkill('')}
              accessibilityRole="button"
              accessibilityLabel="Clear skill filter"
              hitSlop={8}
              style={styles.clearHit}
            >
              <Ionicons name="close-circle" size={17} color={Brand.dim} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.filters}>
        <FilterChips
          options={[...DIRECTORY_FILTERS]}
          value={directoryFilter}
          onChange={setDirectoryFilter}
          accessibilityLabel="Filter people by directory group or year"
        />
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summary}>
          {loading ? 'Loading directory…' : `${filtered.length} of ${people.length} shown`}
        </Text>
        {hasFilters ? (
          <Pressable
            onPress={clearFilters}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            hitSlop={6}
            style={styles.clearFilters}
          >
            <Ionicons name="close" size={13} color={Brand.accent} />
            <Text style={styles.clearFiltersText}>Clear all</Text>
          </Pressable>
        ) : null}
      </View>

      {error && people.length > 0 ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="warning">{error}</StatusBanner>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <PersonCard
            person={item}
            onViewProfile={() =>
              router.push({ pathname: '/people/[id]', params: { id: item.id } })
            }
          />
        )}
        ListEmptyComponent={
          loading ? (
            <RowSkeleton count={6} />
          ) : error ? (
            <ErrorState title="Directory unavailable" message={error} onRetry={() => void load()} />
          ) : hasFilters ? (
            <EmptyState
              icon="search-outline"
              title="No members matched"
              message="Try a broader search, a different filter, or clear the filters."
              action={
                <ActionButton
                  label="Clear filters"
                  icon="close"
                  tone="accent"
                  onPress={clearFilters}
                />
              }
            />
          ) : (
            <EmptyState
              icon="people-outline"
              title="No members yet"
              message="Member profiles will appear here as people join the community."
            />
          )
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

function PersonCard({
  person,
  onViewProfile,
}: {
  person: Profile;
  onViewProfile: () => void;
}) {
  const meta = [
    person.usn,
    person.member_type === 'alumni'
      ? person.graduation_year
        ? `Class of ${person.graduation_year}`
        : 'Alumni'
      : getYearLabel(person.year),
    person.branch,
  ]
    .filter(Boolean)
    .join(' · ');

  const highlights = [...person.skills, ...person.interests, ...person.expertise].slice(0, 4);
  const faculty = isApprovedFaculty(person);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onViewProfile}
        accessibilityRole="button"
        accessibilityLabel={`View ${person.name}'s profile`}
        style={({ pressed }) => [styles.identityRow, pressed && styles.pressed]}
      >
        <Avatar name={person.name} uri={person.avatar_url} size={48} />

        <View style={styles.identityText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {person.name}
            </Text>
            {faculty ? <Badge label="Faculty" tone="accent" /> : null}
            {person.member_type === 'alumni' ? (
              <Badge label={alumniTag(person.graduation_year)} tone="warn" />
            ) : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          {person.designation ? (
            <Text style={styles.designation} numberOfLines={1}>
              {person.designation}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={15} color={Brand.dim} />
      </Pressable>

      {person.bio ? (
        <Text style={styles.bio} numberOfLines={3}>
          {person.bio}
        </Text>
      ) : null}

      {highlights.length > 0 ? (
        <View style={styles.highlights}>
          <ChipRow values={highlights} />
        </View>
      ) : null}

      <View style={styles.footer}>
        <ActionButton
          label="View profile"
          icon="person-outline"
          tone="accent"
          onPress={onViewProfile}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingBottom: 34,
    flexGrow: 1,
  },
  filterCard: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 46,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: Type.body,
    fontSize: 14,
    color: Brand.ink,
    paddingVertical: 10,
  },
  inputDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Brand.line,
  },
  clearHit: {
    minWidth: 32,
    minHeight: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  filters: {
    marginHorizontal: -18,
    marginTop: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    marginBottom: 10,
  },
  summary: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
  },
  clearFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 30,
  },
  clearFiltersText: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.accent,
  },
  bannerWrap: {
    marginBottom: 10,
  },
  separator: {
    height: 10,
  },
  card: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    padding: 14,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  name: {
    flexShrink: 1,
    fontFamily: Type.bodySemiBold,
    fontSize: 14.5,
    color: Brand.ink,
  },
  meta: {
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Brand.dim,
    marginTop: 3,
  },
  designation: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.muted,
    marginTop: 2,
  },
  bio: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.muted,
    marginTop: 11,
  },
  highlights: {
    marginTop: 10,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  pressed: {
    opacity: 0.7,
  },
});
