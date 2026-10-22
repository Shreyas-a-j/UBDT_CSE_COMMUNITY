'use client';

/**
 * Direct message thread — real `public.messages` rows for one conversation.
 *
 * - Access is checked against `conversation_participants` before any messages
 *   are shown (the same RLS predicate protects the reads server-side).
 * - Sending inserts into `messages`; the composer is a real form, not a stub.
 * - `last_read_at` is advanced whenever the thread is opened or a message
 *   arrives while it is on screen.
 * - Realtime INSERTs append to the thread and de-duplicate the sender's own
 *   echoed row.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { normalizeProfile } from '@/lib/profile';
import { formatRelativeTime, getYearLabel, sanitizeText } from '@/lib/community';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { Message, Profile } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { BackHeader, Screen } from '@/components/layout';
import { ErrorState, InlineLoader } from '@/components/states';
import { GhostButton, StatusBanner } from '@/components/ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toDateString() : '';
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const sameYear = date.getFullYear() === today.getFullYear();
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${sameYear ? '' : `, ${date.getFullYear()}`}`;
}

function mapMessageRow(
  row: Record<string, unknown>,
  userId: string | null,
  ownProfile: Profile | null,
  other: Profile | null
): Message {
  const sender = (Array.isArray(row.sender) ? row.sender[0] : row.sender) as
    | Record<string, unknown>
    | null
    | undefined;
  const senderId = String(row.sender_id);
  const fallbackName =
    senderId === userId
      ? (ownProfile?.name ?? 'You')
      : (other?.name ?? 'Community member');

  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    sender_id: senderId,
    body: String(row.body ?? ''),
    created_at: String(row.created_at ?? new Date().toISOString()),
    sender_name: sender ? String(sender.name ?? fallbackName) : fallbackName,
    sender_avatar: sender
      ? ((sender.avatar_url as string | null) ?? null)
      : senderId === userId
        ? (ownProfile?.avatar_url ?? null)
        : (other?.avatar_url ?? null),
  };
}

export default function MessageThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = typeof id === 'string' ? id : null;
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;

  const [other, setOther] = useState<Profile | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const mounted = useRef(true);
  const hasScrolled = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const markRead = useCallback(async () => {
    if (!conversationId || !userId) return;
    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
  }, [conversationId, userId]);

  const load = useCallback(async () => {
    if (!conversationId || !userId) {
      setError('This conversation could not be found.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setAccessDenied(false);

    const participant = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (participant.error) {
      logSupabaseError('Conversation access error', participant.error);
      setError(participant.error.message || 'This conversation could not be opened.');
      setLoading(false);
      return;
    }

    if (!participant.data) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    const [conversation, participants] = await Promise.all([
      supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle(),
      supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', userId),
    ]);

    let nextOther: Profile | null = null;
    const otherId = participants.data?.[0] ? String(participants.data[0].user_id) : null;
    if (otherId) {
      const result = await supabase.from('profiles').select('*').eq('id', otherId).maybeSingle();
      if (result.data) nextOther = normalizeProfile(result.data as Record<string, unknown>);
    }

    let messageResult = await supabase
      .from('messages')
      .select('*, sender:profiles!sender_id (id, name, usn, avatar_url)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (messageResult.error) {
      messageResult = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(200);
    }

    if (!mounted.current) return;

    if (messageResult.error) {
      logSupabaseError('Conversation messages error', messageResult.error);
      setError(messageResult.error.message || 'Messages could not be loaded.');
    } else {
      const rows = ((messageResult.data ?? []) as unknown as Record<string, unknown>[]).slice().reverse();
      setMessages(rows.map((row) => mapMessageRow(row, userId, profile, nextOther)));
      setError(null);
    }

    if (conversation.error) {
      logSupabaseError('Conversation metadata error', conversation.error);
    }

    setOther(nextOther);
    setConversationTitle((conversation.data?.title as string | null) ?? null);
    setLoading(false);
    void markRead();
  }, [conversationId, markRead, profile, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime INSERTs for this thread. Our own send also arrives here, so rows
  // are de-duplicated by message id.
  useEffect(() => {
    if (!conversationId || !userId || accessDenied) return;

    const channel = supabase
      .channel(`thread:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const next = mapMessageRow(row, userId, profile, other);
          setMessages((previous) => {
            if (previous.some((item) => item.id === next.id)) return previous;
            return [...previous, next];
          });
          if (next.sender_id !== userId) void markRead();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [accessDenied, conversationId, markRead, other, profile, userId]);

  const scrollToEnd = useCallback((animated: boolean) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    if (!hasScrolled.current) {
      hasScrolled.current = true;
      scrollToEnd(false);
      return;
    }
    scrollToEnd(true);
  }, [messages.length, scrollToEnd]);

  const send = useCallback(async () => {
    if (!conversationId || !userId || sending) return;
    const body = sanitizeText(draft, 4000);
    if (!body) return;

    setSending(true);
    setSendError(null);

    const { data, error: writeError } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: userId, body })
      .select('*')
      .single();

    if (writeError || !data) {
      setSendError(writeError?.message ?? 'The message could not be sent.');
      setSending(false);
      return;
    }

    const created = mapMessageRow(data as Record<string, unknown>, userId, profile, other);
    setMessages((previous) =>
      previous.some((item) => item.id === created.id) ? previous : [...previous, created]
    );
    setDraft('');
    setSending(false);
    void markRead();
    scrollToEnd(true);
  }, [conversationId, draft, markRead, other, profile, scrollToEnd, sending, userId]);

  const title = other?.name ?? conversationTitle ?? 'Conversation';
  const subtitle = other
    ? [other.usn, getYearLabel(other.year), other.branch].filter(Boolean).join(' · ')
    : 'Private thread';

  const header = useMemo(
    () => (
      <BackHeader
        title={title}
        subtitle={subtitle}
        right={other ? <Avatar name={other.name} uri={other.avatar_url} size={32} /> : undefined}
      />
    ),
    [other, subtitle, title]
  );

  if (loading) {
    return (
      <Screen bottom>
        <BackHeader title="Conversation" />
        <InlineLoader label="Opening conversation" />
      </Screen>
    );
  }

  if (accessDenied) {
    return (
      <Screen bottom>
        <BackHeader title="Conversation" />
        <View style={styles.centered}>
          <View style={styles.lockIcon}>
            <Ionicons name="lock-closed-outline" size={24} color={Brand.warning} />
          </View>
          <Text style={styles.centeredTitle}>Conversation unavailable</Text>
          <Text style={styles.centeredCopy}>
            This thread may have been removed, or your account is not a participant.
          </Text>
          <View style={styles.centeredAction}>
            <GhostButton
              label="Back to messages"
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/network');
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (error && messages.length === 0) {
    return (
      <Screen bottom>
        {header}
        <ErrorState title="Messages unavailable" message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen bottom>
      {header}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            const own = item.sender_id === userId;
            const previous = index > 0 ? messages[index - 1] : null;
            const showDay = !previous || dayKey(previous.created_at) !== dayKey(item.created_at);
            const showAvatar =
              showDay || !previous || previous.sender_id !== item.sender_id;

            return (
              <View>
                {showDay ? (
                  <View style={styles.dayRow}>
                    <View style={styles.dayLine} />
                    <Text style={styles.dayLabel}>{formatDay(item.created_at)}</Text>
                    <View style={styles.dayLine} />
                  </View>
                ) : null}

                <View
                  style={[
                    styles.messageRow,
                    own ? styles.messageRowOwn : styles.messageRowOther,
                    showAvatar && styles.messageRowSpaced,
                  ]}
                >
                  {showAvatar ? (
                    <Avatar
                      name={own ? profile?.name : other?.name}
                      uri={own ? profile?.avatar_url : other?.avatar_url}
                      size={28}
                    />
                  ) : (
                    <View style={styles.avatarSpacer} />
                  )}

                  <View style={[styles.bubbleColumn, own && styles.bubbleColumnOwn]}>
                    <View style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther]}>
                      <Text style={[styles.bubbleText, own && styles.bubbleTextOwn]} selectable>
                        {item.body}
                      </Text>
                    </View>
                    <Text style={[styles.time, own && styles.timeOwn]}>
                      {formatRelativeTime(item.created_at)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyThread}>
              <View style={styles.emptyIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={23} color={Brand.accent} />
              </View>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyCopy}>
                Say hello to {other ? other.name.split(/\s+/)[0] : 'your connection'}. This thread is
                only visible to the two of you.
              </Text>
            </View>
          }
          contentContainerStyle={[
            styles.listContent,
            messages.length === 0 && styles.listContentEmpty,
          ]}
          onContentSizeChange={() => {
            if (!hasScrolled.current && messages.length > 0) {
              hasScrolled.current = true;
              scrollToEnd(false);
            }
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        />

        {sendError ? (
          <View style={styles.sendError}>
            <StatusBanner kind="error">{sendError}</StatusBanner>
          </View>
        ) : null}

        <View style={styles.composer}>
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={(value) => {
                setDraft(value);
                if (sendError) setSendError(null);
              }}
              placeholder={`Message ${other ? other.name.split(/\s+/)[0] : ''}…`}
              placeholderTextColor={Brand.dim}
              style={styles.input}
              multiline
              maxLength={4000}
              textAlignVertical="center"
              selectionColor={Brand.accent}
              underlineColorAndroid="transparent"
              accessibilityLabel="Message"
              editable={!sending}
              onFocus={() => scrollToEnd(true)}
            />
            <Pressable
              onPress={() => void send()}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !draft.trim() || sending, busy: sending }}
              style={({ pressed }) => [
                styles.sendButton,
                (!draft.trim() || sending) && styles.sendButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={sending ? 'ellipsis-horizontal' : 'arrow-up'}
                size={19}
                color={!draft.trim() || sending ? Brand.dim : Brand.accentInk}
              />
            </Pressable>
          </View>
          <Text style={styles.composerHint}>
            {draft.length > 0 ? `${draft.length}/4000 · ` : ''}Messages are private to this connection.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexGrow: 1,
  },
  listContentEmpty: {
    justifyContent: 'center',
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  dayLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Brand.line,
  },
  dayLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 3,
  },
  messageRowSpaced: {
    marginTop: 10,
  },
  messageRowOwn: {
    flexDirection: 'row-reverse',
  },
  messageRowOther: {
    flexDirection: 'row',
  },
  avatarSpacer: {
    width: 28,
  },
  bubbleColumn: {
    maxWidth: '80%',
    alignItems: 'flex-start',
  },
  bubbleColumnOwn: {
    alignItems: 'flex-end',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  bubbleOwn: {
    backgroundColor: Brand.ink,
    borderTopRightRadius: 5,
  },
  bubbleOther: {
    backgroundColor: Brand.elevated,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 5,
  },
  bubbleText: {
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Brand.ink,
  },
  bubbleTextOwn: {
    color: Brand.canvas,
  },
  time: {
    fontFamily: Type.body,
    fontSize: 9.5,
    color: Brand.dim,
    marginTop: 3,
    paddingHorizontal: 3,
  },
  timeOwn: {
    textAlign: 'right',
  },
  emptyThread: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 30,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}44`,
  },
  emptyTitle: {
    fontFamily: Type.display,
    fontSize: 17,
    color: Brand.ink,
    marginTop: 14,
  },
  emptyCopy: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.dim,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 300,
  },
  sendError: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
    backgroundColor: Brand.canvas,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 112,
    fontFamily: Type.body,
    fontSize: 14,
    lineHeight: 20,
    color: Brand.ink,
    backgroundColor: Brand.elevated,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accent,
  },
  sendButtonDisabled: {
    backgroundColor: Brand.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  composerHint: {
    fontFamily: Type.body,
    fontSize: 10,
    color: Brand.dim,
    marginTop: 6,
    marginLeft: 4,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  lockIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(240, 188, 105, 0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(240, 188, 105, 0.35)',
  },
  centeredTitle: {
    fontFamily: Type.display,
    fontSize: 18,
    color: Brand.ink,
    marginTop: 15,
  },
  centeredCopy: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.dim,
    textAlign: 'center',
    marginTop: 7,
    maxWidth: 300,
  },
  centeredAction: {
    marginTop: 18,
    alignSelf: 'stretch',
    maxWidth: 300,
    width: '100%',
  },
  pressed: {
    opacity: 0.7,
  },
});
