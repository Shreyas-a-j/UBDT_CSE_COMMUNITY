import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from './avatar';
import { Badge } from './badge';
import { Chip } from './ui';
import { Brand, Type } from '@/lib/theme';
import { formatRelativeTime, getYearLabel } from '@/lib/community';
import type { Post } from '@/lib/types';

export function PostCard({
  post,
  liked = false,
  upvoted = false,
  onPress,
  onToggleLike,
  onToggleUpvote,
}: {
  post: Post;
  liked?: boolean;
  upvoted?: boolean;
  onPress: () => void;
  onToggleLike?: () => void;
  onToggleUpvote?: () => void;
}) {
  const isShowcase = post.type === 'showcase';
  const tags = post.tags.slice(0, 4);

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
            {[post.author_usn, getYearLabel(post.author_year)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Text style={styles.time}>{formatRelativeTime(post.created_at)}</Text>
      </View>

      {isShowcase ? (
        <View style={styles.typeRow}>
          <Ionicons name="sparkles" size={12} color={Brand.warning} />
          <Text style={styles.typeLabel}>Project showcase</Text>
        </View>
      ) : null}

      <Text style={styles.title} numberOfLines={2}>
        {post.title}
      </Text>
      <Text style={styles.body} numberOfLines={3}>
        {post.body}
      </Text>

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
            <Text style={[styles.metricText, liked && { color: Brand.error }]}>{post.like_count ?? 0}</Text>
          </Pressable>

          {onToggleUpvote ? (
            <Pressable
              onPress={onToggleUpvote}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={upvoted ? 'Remove upvote' : 'Upvote post'}
              accessibilityState={{ selected: upvoted }}
              style={styles.metric}
            >
              <Ionicons
                name={upvoted ? 'arrow-up-circle' : 'arrow-up-circle-outline'}
                size={19}
                color={upvoted ? Brand.accent : Brand.dim}
              />
              <Text style={[styles.metricText, upvoted && { color: Brand.accent }]}>
                {post.upvote_count ?? 0}
              </Text>
            </Pressable>
          ) : null}

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
  time: {
    fontFamily: Type.body,
    fontSize: 11,
    color: Brand.dim,
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
    color: Brand.warning,
  },
  title: {
    fontFamily: Type.display,
    fontSize: 18,
    lineHeight: 24,
    color: Brand.ink,
    marginTop: 10,
  },
  body: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 20,
    color: Brand.muted,
    marginTop: 7,
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
});
