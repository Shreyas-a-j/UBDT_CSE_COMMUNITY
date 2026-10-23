'use client';

/**
 * People directory — real `public.profiles` rows with server-backed connection
 * state. Actions only ever write to the existing tables:
 *   Connect  → insert `connection_requests` (pending)
 *   Accept   → update that pending row to accepted
 *   Message  → `get_or_create_direct_conversation` (accepted connections only)
 *
 * No profiles or relationships are fabricated; a failed write is surfaced and
 * the row stays in its previous state.
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
import { normalizeProfile } from '@/lib/profile';
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

type YearFilter = 'all' | '1' | '2' | '3' | '4';

const YEAR_FILTERS: { value: YearFilter; label: string }[] = [
  { value: 'all', label: 'All years' },
  { value: '1', label: '1st year' },
  { value: '2', label: '2nd year' },
  { value: '3', label: '3rd year' },
  { value: '4', label: '4th year' },
];

interface Relation {
  requestId: string;
  status: 'pending' | 'accepted';
  incoming: boolean;
}

export default function PeopleScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [people, setPeople] = useState<Profile[]>([]);
  const [relations, setRelations] = useState<Map<string, Relation>>(new Map());
  const [query, setQuery] = useState('');
  const [yearFilter, setYearFilter] = useState<YearFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relationsError, setRelationsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      if (!userId) {
        setLoading(false);
        return;
      }
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const [directory, links] = await Promise.all([
        supabase
          .from('profiles')
          // `*` keeps the directory working across schema revisions where
          // optional columns (branch/department, expertise) are absent.
          .select('*')
          .order('name', { ascending: true })
          .limit(200),
        supabase
          .from('connection_requests')
          .select('id, requester_id, addressee_id, status')
          .in('status', ['pending', 'accepted'])
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
          .limit(500),
      ]);

      if (!mounted.current) return;

      if (directory.error) {
        logSupabaseError('People directory error', directory.error);
        setError(directory.error.message || 'The people directory could not be loaded.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const nextPeople = ((directory.data ?? []) as unknown as Record<string, unknown>[])
        .map((row) => normalizeProfile(row))
        .filter((row): row is Profile => row !== null && row.id !== userId)
        .sort((a, b) => a.name.localeCompare(b.name));

      const nextRelations = new Map<string, Relation>();
      for (const row of links.data ?? []) {
        const requesterId = String(row.requester_id);
        const addresseeId = String(row.addressee_id);
        const otherId = requesterId === userId ? addresseeId : requesterId;
        const status = row.status === 'accepted' ? 'accepted' : 'pending';
        nextRelations.set(otherId, {
          requestId: String(row.id),
          status,
          incoming: addresseeId === userId,
        });
      }

      if (links.error) {
        logSupabaseError('Connection status error', links.error);
        setRelationsError(links.error.message || 'Connection statuses could not be loaded.');
      } else {
        setRelationsError(null);
      }

      setPeople(nextPeople);
      setRelations(nextRelations);
      setLoading(false);
      setRefreshing(false);
    },
    [userId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const year = yearFilter === 'all' ? null : Number(yearFilter);

    return people.filter((person) => {
      if (year !== null && person.year !== year) return false;
      if (!needle) return true;
      const haystack = [
        person.name,
        person.usn ?? '',
        person.branch,
        person.bio ?? '',
        person.designation ?? '',
        ...person.skills,
        ...person.interests,
        ...person.expertise,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [people, query, yearFilter]);

  const hasFilters = query.trim().length > 0 || yearFilter !== 'all';
  const clearFilters = useCallback(() => {
    setQuery('');
    setYearFilter('all');
  }, []);

  const connect = useCallback(
    async (person: Profile) => {
      if (!userId || busyId) return;
      setBusyId(person.id);
      setActionError(null);

      const { data, error: writeError } = await supabase
        .from('connection_requests')
        .insert({ requester_id: userId, addressee_id: person.id, status: 'pending' })
        .select('id')
        .single();

      if (writeError || !data) {
        setActionError(writeError?.message ?? 'The connection request could not be sent.');
      } else if (mounted.current) {
        setRelations((previous) => {
          const next = new Map(previous);
          next.set(person.id, { requestId: String(data.id), status: 'pending', incoming: false });
          return next;
        });
      }
      if (mounted.current) setBusyId(null);
    },
    [busyId, userId]
  );

  const accept = useCallback(
    async (person: Profile, requestId: string) => {
      if (busyId) return;
      setBusyId(person.id);
      setActionError(null);

      const { error: writeError } = await supabase
        .from('connection_requests')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('id', requestId);

      if (writeError) {
        setActionError(writeError.message);
      } else if (mounted.current) {
        setRelations((previous) => {
          const next = new Map(previous);
          next.set(person.id, { requestId, status: 'accepted', incoming: true });
          return next;
        });
      }
      if (mounted.current) setBusyId(null);
    },
    [busyId]
  );

  const openMessage = useCallback(
    async (person: Profile) => {
      if (busyId) return;
      setBusyId(person.id);
      setActionError(null);

      const { data, error: rpcError } = await supabase.rpc('get_or_create_direct_conversation', {
        other_user: person.id,
      });

      if (rpcError || !data) {
        setActionError(
          rpcError?.message ?? 'You can only message someone after your connection is accepted.'
        );
        if (mounted.current) setBusyId(null);
        return;
      }
      if (mounted.current) setBusyId(null);
      router.push({ pathname: '/messages/[id]', params: { id: String(data) } });
    },
    [busyId]
  );

  const header = (
    <View>
      <PageHeader
        eyebrow="Directory"
        title="People"
        subtitle="Find students and faculty across every CSE batch, then connect."
        right={
          <ActionButton
            label="Refresh"
            icon="refresh"
            onPress={() => void load(true)}
            busy={refreshing}
          />
        }
      />

      <View style={styles.searchCard}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={17} color={Brand.dim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, USN, skill or interest"
            placeholderTextColor={Brand.dim}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            selectionColor={Brand.accent}
            underlineColorAndroid="transparent"
            accessibilityLabel="Search people"
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
      </View>

      <View style={styles.filters}>
        <FilterChips
          options={YEAR_FILTERS}
          value={yearFilter}
          onChange={setYearFilter}
          accessibilityLabel="Filter people by year"
        />
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summary}>
          {loading ? 'Loading directory…' : `${filtered.length} of ${people.length} people`}
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
            <Text style={styles.clearFiltersText}>Clear filters</Text>
          </Pressable>
        ) : null}
      </View>

      {actionError ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="error">{actionError}</StatusBanner>
        </View>
      ) : null}
      {relationsError ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="warning">{relationsError}</StatusBanner>
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
            relation={relations.get(item.id) ?? null}
            busy={busyId === item.id}
            onConnect={() => void connect(item)}
            onAccept={(requestId) => void accept(item, requestId)}
            onMessage={() => void openMessage(item)}
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
              title="No people match"
              message="Try a different name, USN or year — or clear the filters to see the whole directory."
              action={<ActionButton label="Clear filters" icon="close" tone="accent" onPress={clearFilters} />}
            />
          ) : (
            <EmptyState
              icon="people-outline"
              title="The directory is empty"
              message="No member profiles are visible yet. Pull down to refresh after people join the community."
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
  relation,
  busy,
  onConnect,
  onAccept,
  onMessage,
}: {
  person: Profile;
  relation: Relation | null;
  busy: boolean;
  onConnect: () => void;
  onAccept: (requestId: string) => void;
  onMessage: () => void;
}) {
  const meta = [person.usn, getYearLabel(person.year), person.branch].filter(Boolean).join(' · ');
  const connected = relation?.status === 'accepted';
  const incoming = relation?.status === 'pending' && relation.incoming;
  const outgoing = relation?.status === 'pending' && !relation.incoming;
  const highlights = [...person.skills, ...person.interests, ...person.expertise].slice(0, 4);

  return (
    <View style={styles.card}>
      <View style={styles.identityRow}>
        <Avatar name={person.name} uri={person.avatar_url} size={48} />

        <View style={styles.identityText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {person.name}
            </Text>
            {person.role !== 'student' ? (
              <Badge
                label={
                  person.faculty_status === 'approved' || person.faculty_status === 'verified'
                    ? 'Approved faculty'
                    : person.role
                }
                tone="accent"
              />
            ) : null}
            {connected ? <Badge label="Connected" tone="good" /> : null}
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
      </View>

      {person.bio ? (
        <Text style={styles.bio} numberOfLines={2}>
          {person.bio}
        </Text>
      ) : null}

      {highlights.length > 0 ? (
        <View style={styles.highlights}>
          <ChipRow values={highlights} />
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.relationNote}>
          {connected
            ? 'You are connected'
            : incoming
              ? 'Wants to connect with you'
              : outgoing
                ? 'Request pending'
                : 'Not connected yet'}
        </Text>

        <View style={styles.actions}>
          {connected ? (
            <ActionButton
              label="Message"
              icon="chatbubble-outline"
              tone="accent"
              busy={busy}
              onPress={onMessage}
            />
          ) : incoming && relation ? (
            <ActionButton
              label="Accept"
              icon="checkmark"
              tone="accent"
              busy={busy}
              onPress={() => onAccept(relation.requestId)}
            />
          ) : outgoing ? (
            <ActionButton label="Requested" icon="time-outline" disabled onPress={() => undefined} />
          ) : (
            <ActionButton
              label="Connect"
              icon="person-add-outline"
              tone="accent"
              busy={busy}
              onPress={onConnect}
            />
          )}
        </View>
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
  searchCard: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: Type.body,
    fontSize: 14,
    color: Brand.ink,
    paddingVertical: 10,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  relationNote: {
    flexShrink: 1,
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
});
