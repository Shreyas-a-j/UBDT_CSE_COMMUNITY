import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from './avatar';
import { Badge } from './badge';
import { LinkifiedText } from './linkified-text';
import { Chip } from './ui';
import { Brand, Type } from '@/lib/theme';
import { formatRelativeTime, getYearLabel } from '@/lib/community';
import { formatPinCountdown } from '@/lib/feed-logic';
import type { Post } from '@/lib/types';

export function PostCard({
  post,
  liked = false,
  upvoted = false,
  pinned = false,
  isPopular = false,
  pinBusy = false,
  pinExpiresAt,
  pinLimitReached = false,
  onPinExpired,
  onPress,
  onToggleLike,
  onToggleUpvote,
  onTogglePin,
}: {
  post: Post;
  liked?: boolean;
  upvoted?: boolean;
  pinned?: boolean;
  isPopular?: boolean;
  pinBusy?: boolean;
  pinExpiresAt?: string | null;
  pinLimitReached?: boolean;
  onPinExpired?: () => void;
  onPress: () => void;
  onToggleLike?: () => void;
  onToggleUpvote?: () => void;
  onTogglePin?: () => void;
}) {
  const isShowcase = post.type === 'showcase';
  const tags = post.tags.slice(0, 4);
  const expiresAt = pinExpiresAt ?? post.pin_expires_at ?? null;
  const [now, setNow] = useState(() => new Date());
  const expiryNotified = useRef(false);

  const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const pinActive = pinned && (!expiresAt || (Number.isFinite(expiresMs) && expiresMs > now.getTime()));
  const pinSlotsFull = pinLimitReached && !pinned;

  useEffect(() => {
    if (!pinActive || !expiresAt) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [pinActive, expiresAt]);

  useEffect(() => {
    if (!pinned || !expiresAt) return;
    if (formatPinCountdown(expiresAt, now) !== 'Expired') return;
    if (expiryNotified.current) return;
    expiryNotified.current = true;
    onPinExpired?.();
  }, [expiresAt, now, onPinExpired, pinned]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${isShowcase ? 'showcase' : 'discussion'}: ${post.title}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.header}>
        <Avatar name={post.author_name} uri={post.author_avatar} size={42} />
        <View style={styles.author}>
          <View style={styles.authorLine}>
            <Text style={styles.authorName} numberOfLines={1}>
              {post.author_name ?? 'CSE member'}
            </Text>
            {post.author_role && post.author_role !== 'student' ? (
              <Badge label={post.author_role} tone="accent" />
            ) : null}
          </View>
          <Text style={styles.authorMeta} numberOfLines={1}>
            {[post.author_usn, getYearLabel(post.author_year), formatRelativeTime(post.created_at)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <View style={styles.badges}>
          {isShowcase && isPopular ? (
            <View style={styles.popularBadge} accessibilityLabel="Popular project">
              <Text style={styles.popularEmoji}>🏆</Text>
            </View>
          ) : null}
          {onTogglePin ? (
            <Pressable
              onPress={(event) => {
                event.stopPropagation?.();
                onTogglePin();
              }}
              disabled={pinBusy || pinSlotsFull}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                pinned
                  ? 'Unpin discussion'
                  : pinSlotsFull
                    ? 'Maximum 3 active pins'
                    : 'Pin discussion'
              }
              accessibilityState={{ disabled: pinBusy || pinSlotsFull, selected: pinned }}
              style={({ pressed }) => [styles.pinButton, pressed && styles.pressed]}
            >
              <Ionicons
                name={pinned ? 'pin' : 'pin-outline'}
                size={16}
                color={pinned ? Brand.accent : Brand.dim}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {pinActive ? (
        <View style={styles.pinBanner}>
          <Ionicons name="pin" size={13} color={Brand.accent} />
          <Text style={styles.pinBannerText}>
            Pinned by faculty
            {expiresAt ? ` · ${formatPinCountdown(expiresAt, now)}` : ''}
          </Text>
        </View>
      ) : null}

      <View style={styles.typeRow}>
        <Ionicons
          name={isShowcase ? 'sparkles' : 'chatbubble-ellipses-outline'}
          size={12}
          color={isShowcase ? Brand.warning : Brand.dim}
        />
        <Text style={[styles.typeLabel, isShowcase && { color: Brand.warning }]}>
          {isShowcase ? 'Project showcase' : 'Discussion'}
        </Text>
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {post.title}
      </Text>
      <LinkifiedText text={post.body} style={styles.body} numberOfLines={3} />

      {post.image_url ? (
        <Image
          source={{ uri: post.image_url }}
          style={styles.image}
          resizeMode="cover"
          accessibilityLabel={`Image attached to ${post.title}`}
        />
      ) : null}

      {isShowcase && (post.github_url || post.demo_url) ? (
        <View style={styles.links}>
          {post.demo_url ? (
            <View style={styles.projectLink}>
              <Ionicons name="open-outline" size={13} color={Brand.accent} />
              <Text style={styles.projectLinkText}>Live demo</Text>
            </View>
          ) : null}
          {post.github_url ? (
            <View style={styles.projectLink}>
              <Ionicons name="git-branch-outline" size={13} color={Brand.muted} />
              <Text style={[styles.projectLinkText, { color: Brand.muted }]}>Source</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {tags.length > 0 ? (
        <View style={styles.tags}>
          {tags.map((tag) => (
            <Chip key={tag} text={`#${tag}`} />
          ))}
          {post.tags.length > tags.length ? <Chip text={`+${post.tags.length - tags.length}`} /> : null}
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.engagement}>
          {isShowcase ? (
            <Pressable
              onPress={onToggleUpvote}
              disabled={!onToggleUpvote}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={upvoted ? 'Remove upvote' : 'Upvote post'}
              accessibilityState={{ selected: upvoted }}
              style={styles.metric}
            >
              <Ionicons
                name={upvoted ? 'arrow-up-circle' : 'arrow-up-circle-outline'}
                size={19}
                color={upvoted ? Brand.warning : Brand.dim}
              />
              <Text style={[styles.metricText, upvoted && { color: Brand.warning }]}>
                {post.upvote_count ?? 0}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={onToggleLike}
              disabled={!onToggleLike}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={liked ? 'Unlike post' : 'Like post'}
              accessibilityState={{ selected: liked }}
              style={styles.metric}
            >
              <Ionicons
                name={liked ? 'heart' : 'heart-outline'}
                size={18}
                color={liked ? Brand.error : Brand.dim}
              />
              <Text style={[styles.metricText, liked && { color: Brand.error }]}>
                {post.like_count ?? 0}
              </Text>
            </Pressable>
          )}

          <View style={styles.metric}>
            <Ionicons name="chatbubble-outline" size={17} color={Brand.dim} />
            <Text style={styles.metricText}>{post.comment_count ?? 0}</Text>
          </View>
        </View>

        <View style={styles.readMore}>
          <Text style={styles.readMoreText}>Open</Text>
          <Ionicons name="chevron-forward" size={14} color={Brand.accent} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
  },
  cardPressed: {
    borderColor: Brand.lineStrong,
    backgroundColor: '#282A2F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  author: {
    flex: 1,
    minWidth: 0,
  },
  authorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  authorName: {
    flexShrink: 1,
    fontFamily: Type.bodySemiBold,
    fontSize: 13.5,
    color: Brand.ink,
  },
  authorMeta: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    marginTop: 3,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  popularBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(240, 188, 105, 0.12)',
  },
  popularEmoji: {
    fontSize: 13,
  },
  pinButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 11,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
    backgroundColor: Brand.accentSoft,
  },
  pinBannerText: {
    fontFamily: Type.bodyMedium,
    fontSize: 11,
    color: Brand.accent,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 13,
  },
  typeLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  title: {
    fontFamily: Type.display,
    fontSize: 18,
    lineHeight: 24,
    color: Brand.ink,
    marginTop: 8,
  },
  body: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 20,
    color: Brand.muted,
    marginTop: 7,
  },
  image: {
    width: '100%',
    height: 170,
    borderRadius: 10,
    marginTop: 12,
    backgroundColor: Brand.elevated,
  },
  links: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 11,
  },
  projectLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  projectLinkText: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.accent,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  engagement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
  },
  metricText: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    color: Brand.dim,
  },
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  readMoreText: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    color: Brand.accent,
  },
  pressed: {
    opacity: 0.65,
  },
});
