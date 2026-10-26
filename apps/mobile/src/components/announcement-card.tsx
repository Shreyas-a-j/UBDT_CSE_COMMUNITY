import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from './avatar';
import { AnnouncementImageViewer } from './announcement-image-viewer';
import { LinkifiedText } from './linkified-text';
import { ANNOUNCEMENT_REACTIONS } from '@/lib/feed-logic';
import { computeAnnouncementImageLayout } from '@/lib/announcement-image-layout';
import { formatRelativeTime, summarizeReactions } from '@/lib/community';
import { Brand, Type } from '@/lib/theme';
import { useAnnouncementImageAspects } from '@/lib/use-announcement-image-aspects';
import type { Announcement, AnnouncementReaction } from '@/lib/types';

const ANNOUNCEMENT_IMAGE_GAP = 6;

/**
 * A faculty announcement card. Renders the author, time, title, linkified body,
 * optional images (tap to open full screen) and the four reaction toggles.
 * There are deliberately no comments or replies — announcements are one-way.
 */
export function AnnouncementCard({
  announcement,
  viewerId,
  variant = 'card',
  onToggleReaction,
  onDelete,
  deleting = false,
  disabled = false,
}: {
  announcement: Announcement;
  viewerId?: string | null;
  variant?: 'card' | 'message';
  onToggleReaction?: (reaction: AnnouncementReaction) => void;
  onDelete?: () => void;
  deleting?: boolean;
  disabled?: boolean;
}) {
  const { counts, mine } = summarizeReactions(announcement.reactions, viewerId);
  const images = useMemo(
    () => announcement.image_urls.slice(0, 4),
    [announcement.image_urls]
  );
  const aspects = useAnnouncementImageAspects(images);
  const [imageWidth, setImageWidth] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const rows = aspects
    ? computeAnnouncementImageLayout(aspects, imageWidth, ANNOUNCEMENT_IMAGE_GAP)
    : [];

  return (
    <View style={[styles.card, variant === 'message' && styles.message]}>
      <View style={styles.header}>
        <Avatar name={announcement.author_name} uri={announcement.author_avatar} size={38} />
        <View style={styles.author}>
          <Text style={styles.authorName} numberOfLines={1}>
            {announcement.author_name ?? 'Faculty'}
          </Text>
          <Text style={styles.authorMeta} numberOfLines={1}>
            {[announcement.author_designation, formatRelativeTime(announcement.created_at)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {onDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={deleting}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete announcement"
            accessibilityState={{ disabled: deleting }}
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
          >
            <Ionicons name="trash-outline" size={15} color={Brand.dim} />
          </Pressable>
        ) : null}
        <View style={styles.megaphone}>
          <Ionicons name="megaphone" size={14} color={Brand.accent} />
        </View>
      </View>

      <Text style={styles.title}>{announcement.title}</Text>
      <LinkifiedText text={announcement.body} style={styles.body} />

      {images.length > 0 ? (
        <>
          <View
            style={styles.images}
            onLayout={(event) => {
              const width = event.nativeEvent.layout.width;
              setImageWidth((previous) =>
                Math.abs(previous - width) < 0.5 ? previous : width
              );
            }}
          >
            {rows.length > 0 ? (
              rows.map((row, rowIndex) => (
                <View
                  key={`${announcement.id}-row-${rowIndex}`}
                  style={styles.imageRow}
                >
                  {row.tiles.map((tile) => (
                    <Pressable
                      key={`${announcement.id}-image-${tile.index}`}
                      onPress={() => setViewerIndex(tile.index)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Announcement image ${tile.index + 1} of ${images.length}`}
                      accessibilityHint="Opens the image full screen"
                      style={({ pressed }) => [
                        styles.imageButton,
                        { width: tile.width, height: tile.height },
                        pressed && styles.imagePressed,
                      ]}
                    >
                      <Image
                        source={{ uri: images[tile.index] }}
                        style={styles.image}
                        resizeMode="cover"
                        resizeMethod="resize"
                        accessible={false}
                      />
                    </Pressable>
                  ))}
                </View>
              ))
            ) : (
              <View
                style={styles.imageSkeleton}
                accessibilityLabel="Loading announcement images"
              />
            )}
          </View>
          {viewerIndex !== null ? (
            <AnnouncementImageViewer
              urls={images}
              title={announcement.title}
              initialIndex={viewerIndex}
              visible
              onClose={() => setViewerIndex(null)}
            />
          ) : null}
        </>
      ) : null}

      <View style={styles.reactions}>
        {ANNOUNCEMENT_REACTIONS.map((reaction) => {
          const active = mine.includes(reaction.type);
          const count = counts[reaction.type];
          return (
            <Pressable
              key={reaction.type}
              onPress={() => onToggleReaction?.(reaction.type)}
              disabled={!onToggleReaction || disabled}
              accessibilityRole="button"
              accessibilityLabel={`${reaction.label}${count ? `, ${count}` : ''}`}
              accessibilityState={{ selected: active, disabled: !onToggleReaction || disabled }}
              style={({ pressed }) => [
                styles.reaction,
                active && styles.reactionActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
              <Text style={[styles.reactionCount, active && styles.reactionCountActive]}>{count}</Text>
            </Pressable>
          );
        })}
        <Text style={styles.reactionHint}>React</Text>
      </View>
    </View>
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
  message: {
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Brand.line,
    borderRadius: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: 14,
    paddingBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  author: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    fontFamily: Type.bodySemiBold,
    fontSize: 13.5,
    color: Brand.ink,
  },
  authorMeta: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    marginTop: 2,
  },
  megaphone: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
  },
  deleteButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Type.display,
    fontSize: 18,
    lineHeight: 24,
    color: Brand.ink,
    marginTop: 13,
  },
  body: {
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 21,
    color: Brand.muted,
    marginTop: 7,
  },
  images: {
    gap: ANNOUNCEMENT_IMAGE_GAP,
    marginTop: 12,
  },
  imageRow: {
    flexDirection: 'row',
    gap: ANNOUNCEMENT_IMAGE_GAP,
  },
  imageButton: {
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: Brand.elevated,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageSkeleton: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 9,
    backgroundColor: Brand.elevated,
  },
  imagePressed: {
    opacity: 0.82,
  },
  reactions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 14,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 9,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
  },
  reactionActive: {
    borderColor: `${Brand.accent}99`,
    backgroundColor: Brand.accentSoft,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.dim,
  },
  reactionCountActive: {
    color: Brand.accent,
  },
  reactionHint: {
    flex: 1,
    textAlign: 'right',
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
  },
  pressed: {
    opacity: 0.65,
  },
});
