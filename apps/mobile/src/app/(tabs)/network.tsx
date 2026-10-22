'use client';

/**
 * Network tab — the real people layer:
 *   Connections · Requests · Messages
 *
 * Connections and requests come from `connection_requests`; conversations are
 * read from `conversations` / `conversation_participants` / `messages`. The
 * Message action calls the existing `get_or_create_direct_conversation` RPC,
 * which only permits accepted connections (enforced server-side).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { normalizeProfile } from '@/lib/profile';
import { formatRelativeTime, getYearLabel } from '@/lib/community';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { ConnectionRequest, Conversation, Profile } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { PageHeader, Screen } from '@/components/layout';
import { SegmentedControl } from '@/components/segmented';
import { RowSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { ActionButton, StatusBanner } from '@/components/ui';

type NetworkTab = 'connections' | 'requests' | 'messages';

type NetworkRow =
  | { kind: 'connection'; id: string; person: Profile }
  | { kind: 'received'; id: string; request: ConnectionRequest }
  | { kind: 'sent'; id: string; request: ConnectionRequest }
  | { kind: 'conversation'; id: string; conversation: Conversation };

type NetworkSection = { title: string; data: NetworkRow[]; kind: NetworkTab };

function profileFromEmbed(value: unknown): Profile | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  return normalizeProfile(row as Record<string, unknown>);
}

async function loadConversations(userId: string): Promise<Conversation[]> {
  const participants = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', userId);

  if (participants.error || !participants.data?.length) return [];

  const ids = participants.data.map((row) => String(row.conversation_id));
  const lastRead = new Map(
    participants.data.map((row) => [String(row.conversation_id), String(row.last_read_at ?? '')])
  );

  const conversations = await supabase
    .from('conversations')
    .select('*')
    .in('id', ids)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(30);

  if (conversations.error || !conversations.data) return [];

  const others = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id')
    .in('conversation_id', ids)
    .neq('user_id', userId);

  const otherIds = Array.from(new Set((others.data ?? []).map((row) => String(row.user_id))));
  const profiles = otherIds.length
    ? await supabase.from('profiles').select('*').in('id', otherIds)
    : { data: [], error: null };

  const profileById = new Map(
    (profiles.data ?? []).map((row) => {
      const profile = normalizeProfile(row as Record<string, unknown>);
      return [String(row.id), profile] as const;
    })
  );
  const otherByConversation = new Map(
    (others.data ?? []).map((row) => [String(row.conversation_id), String(row.user_id)])
  );

  const unread = await Promise.all(
    conversations.data.map(async (row) => {
      const id = String(row.id);
      const since = lastRead.get(id);
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', id)
        .neq('sender_id', userId)
        .gt('created_at', since || '1970-01-01T00:00:00.000Z');
      return [id, count ?? 0] as const;
    })
  );
  const unreadById = new Map(unread);

  return conversations.data.map((row) => {
    const id = String(row.id);
    const otherId = otherByConversation.get(id);
    return {
      id,
      is_group: Boolean(row.is_group),
      title: (row.title as string | null) ?? null,
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
      last_message_at: (row.last_message_at as string | null) ?? null,
      last_message_preview: (row.last_message_preview as string | null) ?? null,
      other: otherId ? profileById.get(otherId) ?? null : null,
      unread_count: unreadById.get(id) ?? 0,
    };
  });
}

export default function NetworkScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const params = useLocalSearchParams<{ tab?: string }>();

  const [tab, setTab] = useState<NetworkTab>('connections');
  const [connections, setConnections] = useState<Profile[]>([]);
  const [received, setReceived] = useState<ConnectionRequest[]>([]);
  const [sent, setSent] = useState<ConnectionRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (params.tab === 'messages' || params.tab === 'requests' || params.tab === 'connections') {
      setTab(params.tab);
    }
  }, [params.tab]);

  const load = useCallback(
    async (refresh = false) => {
      if (!userId) {
        setLoading(false);
        return;
      }
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const [accepted, incoming, outgoing] = await Promise.all([
        supabase
          .from('connection_requests')
          .select(`
            *,
            requester:profiles!requester_id (*),
            addressee:profiles!addressee_id (*)
          `)
          .eq('status', 'accepted')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
        supabase
          .from('connection_requests')
          .select(`
            *,
            requester:profiles!requester_id (*)
          `)
          .eq('addressee_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
        supabase
          .from('connection_requests')
          .select(`
            *,
            addressee:profiles!addressee_id (*)
          `)
          .eq('requester_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ]);

      const nextConnections: Profile[] = [];
      for (const row of (accepted.data ?? []) as Record<string, unknown>[]) {
        const isRequester = String(row.requester_id) === userId;
        const person = profileFromEmbed(isRequester ? row.addressee : row.requester);
        if (person) nextConnections.push(person);
      }
      nextConnections.sort((a, b) => a.name.localeCompare(b.name));

      if (accepted.error || incoming.error || outgoing.error) {
        const message =
          accepted.error?.message ?? incoming.error?.message ?? outgoing.error?.message ?? 'Network unavailable.';
        logSupabaseError('Network load error', accepted.error ?? incoming.error ?? outgoing.error);
        setError(message);
      }

      if (mounted.current) {
        setConnections(nextConnections);
        setReceived((incoming.data ?? []) as unknown as ConnectionRequest[]);
        setSent((outgoing.data ?? []) as unknown as ConnectionRequest[]);
      }

      try {
        const nextConversations = await loadConversations(userId);
        if (mounted.current) setConversations(nextConversations);
      } catch {
        if (mounted.current) setConversations([]);
      }

      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refreshRef = useRef(load);
  const firstFocus = useRef(false);

  useEffect(() => {
    refreshRef.current = load;
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) void refreshRef.current(true);
      else firstFocus.current = true;
    }, [])
  );

  const updateRequest = useCallback(
    async (request: ConnectionRequest, status: 'accepted' | 'rejected' | 'cancelled') => {
      setBusyId(request.id);
      setActionError(null);
      const { error: writeError } = await supabase
        .from('connection_requests')
        .update({ status })
        .eq('id', request.id);
      if (writeError) {
        setActionError(writeError.message);
      } else {
        await load(true);
      }
      setBusyId(null);
    },
    [load]
  );

  const openMessage = useCallback(async (person: Profile) => {
    setBusyId(person.id);
    setActionError(null);
    const { data, error: rpcError } = await supabase.rpc('get_or_create_direct_conversation', {
      other_user: person.id,
    });
    if (rpcError || !data) {
      setActionError(rpcError?.message ?? 'The conversation could not be opened.');
      setBusyId(null);
      return;
    }
    setBusyId(null);
    router.push({ pathname: '/messages/[id]', params: { id: String(data) } });
  }, []);

  const sections = useMemo<NetworkSection[]>(() => {
    if (tab === 'connections') {
      return [
        {
          title: 'Your connections',
          kind: 'connections',
          data: connections.map((person) => ({ kind: 'connection' as const, id: person.id, person })),
        },
      ];
    }
    if (tab === 'requests') {
      return [
        {
          title: 'Received',
          kind: 'requests',
          data: received.map((request) => ({ kind: 'received' as const, id: request.id, request })),
        },
        {
          title: 'Sent',
          kind: 'requests',
          data: sent.map((request) => ({ kind: 'sent' as const, id: request.id, request })),
        },
      ];
    }
    return [
      {
        title: 'Conversations',
        kind: 'messages',
        data: conversations.map((conversation) => ({
          kind: 'conversation' as const,
          id: conversation.id,
          conversation,
        })),
      },
    ];
  }, [connections, conversations, received, sent, tab]);

  const nonEmptySections = sections.filter((section) => section.data.length > 0);
  const totalRows = nonEmptySections.reduce((sum, section) => sum + section.data.length, 0);

  const empty = loading ? (
    <RowSkeleton count={5} />
  ) : error ? (
    <ErrorState message={error} onRetry={() => void load()} />
  ) : tab === 'connections' ? (
    <EmptyState
      icon="people-outline"
      title="No connections yet"
      message="Find classmates and faculty in the directory, then send a connection request."
      action={<ActionButton label="Find people" icon="person-add-outline" tone="accent" onPress={() => router.push('/people')} />}
    />
  ) : tab === 'requests' ? (
    <EmptyState
      icon="mail-open-outline"
      title="No pending requests"
      message="Incoming and outgoing connection requests will appear here."
      action={<ActionButton label="Find people" icon="person-add-outline" tone="accent" onPress={() => router.push('/people')} />}
    />
  ) : (
    <EmptyState
      icon="chatbubble-ellipses-outline"
      title="No messages yet"
      message="Connect with someone first, then start a private conversation from your connections."
      action={<ActionButton label="Find people" icon="person-add-outline" tone="accent" onPress={() => router.push('/people')} />}
    />
  );

  return (
    <Screen>
      <PageHeader
        eyebrow="Your network"
        title="Network"
        subtitle="Connections, requests and private messages in one place."
        right={<ActionButton label="Find" icon="search-outline" tone="accent" onPress={() => router.push('/people')} />}
      />

      <View style={styles.segmentWrap}>
        <SegmentedControl
          options={[
            { value: 'connections', label: 'Connections', count: connections.length },
            { value: 'requests', label: 'Requests', count: received.length },
            { value: 'messages', label: 'Messages', count: conversations.length },
          ]}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Network views"
        />
      </View>

      {actionError ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="error">{actionError}</StatusBanner>
        </View>
      ) : null}
      {error && totalRows > 0 ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="warning">{error}</StatusBanner>
        </View>
      ) : null}

      <SectionList
        sections={nonEmptySections}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        renderItem={({ item }) => (
          <NetworkRowView
            row={item}
            busy={busyId === (item.kind === 'connection' ? item.person.id : item.id)}
            onAccept={(request) => void updateRequest(request, 'accepted')}
            onReject={(request) => void updateRequest(request, 'rejected')}
            onCancel={(request) => void updateRequest(request, 'cancelled')}
            onMessage={(person) => void openMessage(person)}
          />
        )}
        renderSectionHeader={({ section }) =>
          section.data.length > 0 ? (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={empty}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

function NetworkRowView({
  row,
  busy,
  onAccept,
  onReject,
  onCancel,
  onMessage,
}: {
  row: NetworkRow;
  busy: boolean;
  onAccept: (request: ConnectionRequest) => void;
  onReject: (request: ConnectionRequest) => void;
  onCancel: (request: ConnectionRequest) => void;
  onMessage: (person: Profile) => void;
}) {
  if (row.kind === 'connection') {
    const person = row.person;
    return (
      <View style={styles.card}>
        <View style={styles.identityRow}>
          <Avatar name={person.name} uri={person.avatar_url} size={44} />
          <View style={styles.identityText}>
            <View style={styles.nameLine}>
              <Text style={styles.name} numberOfLines={1}>
                {person.name}
              </Text>
              {person.role !== 'student' ? <Badge label={person.role} tone="accent" /> : null}
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {[person.usn, getYearLabel(person.year), person.branch].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <ActionButton
            label="Message"
            icon="chatbubble-outline"
            tone="accent"
            busy={busy}
            onPress={() => onMessage(person)}
          />
        </View>
      </View>
    );
  }

  if (row.kind === 'received') {
    const person = row.request.requester;
    if (!person) return null;
    return (
      <View style={styles.card}>
        <View style={styles.identityRow}>
          <Avatar name={person.name} uri={person.avatar_url} size={44} />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>
              {person.name}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              Wants to connect · {[person.usn, getYearLabel(person.year)].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <ActionButton
            label="Accept"
            icon="checkmark"
            tone="accent"
            busy={busy}
            onPress={() => onAccept(row.request)}
          />
          <ActionButton
            label="Decline"
            icon="close"
            tone="danger"
            disabled={busy}
            onPress={() => onReject(row.request)}
          />
        </View>
      </View>
    );
  }

  if (row.kind === 'sent') {
    const person = row.request.addressee;
    if (!person) return null;
    return (
      <View style={styles.card}>
        <View style={styles.identityRow}>
          <Avatar name={person.name} uri={person.avatar_url} size={44} />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>
              {person.name}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              Request sent · {[person.usn, getYearLabel(person.year)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <ActionButton label="Cancel" tone="danger" disabled={busy} onPress={() => onCancel(row.request)} />
        </View>
      </View>
    );
  }

  const conversation = row.conversation;
  const other = conversation.other;
  const unread = (conversation.unread_count ?? 0) > 0;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/messages/[id]', params: { id: conversation.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Open conversation with ${other?.name ?? conversation.title ?? 'member'}`}
      style={({ pressed }) => [styles.card, styles.conversationCard, pressed && styles.pressed]}
    >
      <Avatar name={other?.name ?? conversation.title} uri={other?.avatar_url} size={46} />
      <View style={styles.identityText}>
        <View style={styles.nameLine}>
          <Text style={[styles.name, unread && styles.unreadName]} numberOfLines={1}>
            {other?.name ?? conversation.title ?? 'Conversation'}
          </Text>
          {unread ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{conversation.unread_count}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.meta, unread && styles.unreadPreview]} numberOfLines={1}>
          {conversation.last_message_preview || 'No messages yet'}
        </Text>
      </View>
      {conversation.last_message_at ? (
        <Text style={styles.time}>{formatRelativeTime(conversation.last_message_at)}</Text>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={Brand.dim} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segmentWrap: {
    marginHorizontal: -18,
    marginBottom: 10,
  },
  bannerWrap: {
    marginHorizontal: 18,
    marginBottom: 10,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
    flexGrow: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    paddingBottom: 9,
  },
  sectionTitle: {
    fontFamily: Type.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  sectionCount: {
    fontFamily: Type.bodyMedium,
    fontSize: 10.5,
    color: Brand.dim,
    backgroundColor: Brand.elevated,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  card: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    padding: 14,
    marginBottom: 10,
  },
  conversationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 13,
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
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  name: {
    flexShrink: 1,
    fontFamily: Type.bodySemiBold,
    fontSize: 14,
    color: Brand.ink,
  },
  unreadName: {
    fontFamily: Type.bodySemiBold,
    color: '#FFFFFF',
  },
  meta: {
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Brand.dim,
    marginTop: 3,
  },
  unreadPreview: {
    color: Brand.muted,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 12,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: Brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    fontFamily: Type.bodySemiBold,
    fontSize: 10,
    color: Brand.accentInk,
  },
  time: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
    alignSelf: 'flex-start',
    paddingTop: 3,
  },
  pressed: {
    opacity: 0.7,
  },
});
