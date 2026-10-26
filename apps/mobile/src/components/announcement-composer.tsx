'use client';

/**
 * Shared announcement composer used by the create and edit routes.
 *
 * Text and up to four images are validated with the website's rules. Images are
 * uploaded through the existing faculty-gated website route, then the row is
 * written to `public.announcements`. RLS remains the authority: the insert
 * policy requires the signed-in approved-faculty author, and updates are
 * limited to the author or an admin.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { sanitizeText } from '@/lib/community';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/keyboard';
import { canPublishFacultyContent, isAdmin } from '@/lib/profile';
import {
  ANNOUNCEMENT_MAX_IMAGES,
  normalizeImageUrls,
} from '@/lib/announcement-image-rules';
import {
  pickAnnouncementImages,
  uploadAnnouncementImage,
  type PickedAnnouncementImage,
} from '@/lib/announcement-images';
import { Brand, Type } from '@/lib/theme';
import { BackHeader, Screen } from '@/components/layout';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/states';
import { GhostButton, PrimaryButton, StatusBanner, TextField } from '@/components/ui';

export function AnnouncementComposer({ announcementId }: { announcementId?: string }) {
  const { profile, session, loading: authLoading } = useAuth();
  const insets = useSafeAreaInsets();
  const editing = Boolean(announcementId);
  const userId = session?.user.id ?? null;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [pendingImages, setPendingImages] = useState<PickedAnnouncementImage[]>([]);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(!editing);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPublish = canPublishFacultyContent(profile);
  const imageCount = existingImages.length + pendingImages.length;

  useEffect(() => {
    if (!editing || !announcementId || !userId) return;
    let active = true;

    (async () => {
      const { data, error: queryError } = await supabase
        .from('announcements')
        .select('id, author_id, title, body, image_urls, created_at, updated_at')
        .eq('id', announcementId)
        .maybeSingle();

      if (!active) return;

      if (queryError || !data) {
        setLoadError(queryError?.message || 'This announcement could not be loaded.');
        setLoading(false);
        return;
      }

      const row = data as Record<string, unknown>;
      setTitle(String(row.title ?? ''));
      setBody(String(row.body ?? ''));
      setExistingImages(normalizeImageUrls(row.image_urls));
      setCanEdit(row.author_id === userId || isAdmin(profile));
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [announcementId, editing, profile, userId]);

  const addImages = useCallback(async () => {
    if (submitting) return;
    setError(null);

    const remaining = ANNOUNCEMENT_MAX_IMAGES - imageCount;
    const { images, error: pickError } = await pickAnnouncementImages(remaining);
    if (pickError) setError(pickError);
    if (images.length > 0) setPendingImages((previous) => [...previous, ...images]);
  }, [imageCount, submitting]);

  const removeExisting = (uri: string) => {
    setExistingImages((previous) => previous.filter((item) => item !== uri));
  };

  const removePending = (id: string) => {
    setPendingImages((previous) => previous.filter((image) => image.id !== id));
  };

  const submit = async () => {
    if (!userId) {
      setError('Your session has expired. Sign in again to publish.');
      return;
    }
    if (!canPublish) {
      setError('Only approved faculty can publish announcements.');
      return;
    }
    if (editing && !canEdit) {
      setError('Only the author or an administrator can edit this announcement.');
      return;
    }

    const cleanTitle = sanitizeText(title, 200);
    const cleanBody = sanitizeText(body, 5000);
    if (!cleanTitle) {
      setError('Please enter a title.');
      return;
    }
    if (!cleanBody) {
      setError('Please enter announcement content.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const uploaded: string[] = [];
      for (const [index, image] of pendingImages.entries()) {
        setUploadProgress(
          `Uploading image ${index + 1} of ${pendingImages.length}…`
        );
        uploaded.push(await uploadAnnouncementImage(image));
      }

      const imageUrls = normalizeImageUrls([...existingImages, ...uploaded]);
      setUploadProgress(editing ? 'Saving changes…' : 'Publishing…');

      if (editing && announcementId) {
        const { data, error: updateError } = await supabase
          .from('announcements')
          .update({ title: cleanTitle, body: cleanBody, image_urls: imageUrls })
          .eq('id', announcementId)
          .select('id');
        if (updateError) throw new Error(updateError.message);
        if (!data || data.length === 0) {
          throw new Error(
            'The announcement could not be saved. You may not have permission to edit it.'
          );
        }
      } else {
        const { error: insertError } = await supabase.from('announcements').insert({
          author_id: userId,
          title: cleanTitle,
          body: cleanBody,
          image_urls: imageUrls,
        });
        if (insertError) throw new Error(insertError.message);
      }

      setSubmitting(false);
      setUploadProgress(null);
      router.back();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'The announcement could not be published.'
      );
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  if (authLoading) {
    return (
      <Screen bottom>
        <BackHeader title={editing ? 'Edit announcement' : 'New announcement'} subtitle="Faculty workspace" />
        <View style={styles.loadingWrap}>
          <ListSkeleton count={3} />
        </View>
      </Screen>
    );
  }

  if (!canPublish) {
    return (
      <Screen bottom>
        <BackHeader title={editing ? 'Edit announcement' : 'New announcement'} subtitle="Faculty workspace" />
        <EmptyState
          icon="lock-closed-outline"
          title="Access denied"
          message="Faculty verification is required to publish announcements. Contact an administrator if you believe this is a mistake."
          action={<GhostButton label="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  if (editing && loading) {
    return (
      <Screen bottom>
        <BackHeader title="Edit announcement" subtitle="Faculty workspace" />
        <View style={styles.loadingWrap}>
          <ListSkeleton count={3} />
        </View>
      </Screen>
    );
  }

  if (loadError || !canEdit) {
    return (
      <Screen bottom>
        <BackHeader title="Edit announcement" subtitle="Faculty workspace" />
        <EmptyState
          icon="alert-circle-outline"
          title={loadError ? 'Announcement unavailable' : 'Edit not permitted'}
          message={
            loadError ??
            'Only the announcement author or an administrator can edit this announcement.'
          }
          action={<GhostButton label="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  return (
    <Screen bottom>
      <BackHeader
        title={editing ? 'Edit announcement' : 'New announcement'}
        subtitle="Published to #announcements"
      />
      <KeyboardAvoidingView behavior={KEYBOARD_AVOIDING_BEHAVIOR} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <View style={styles.notice}>
            <Ionicons name="megaphone-outline" size={16} color={Brand.accent} />
            <Text style={styles.noticeText}>
              Announcements are department-wide and visible to everyone, whatever batch they are
              browsing.
            </Text>
          </View>

          <TextField
            label="Title"
            placeholder="e.g. Project submission deadline extended"
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            editable={!submitting}
            hint={`${title.length}/200`}
          />

          <TextField
            label="Content"
            placeholder="Write the announcement. Include dates, venues and any action students need to take."
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={5000}
            editable={!submitting}
            hint={`${body.length}/5000`}
          />

          <View>
            <View style={styles.imageLabelRow}>
              <Text style={styles.imageLabel}>Images (optional)</Text>
              <Text style={styles.imageCount}>
                {imageCount}/{ANNOUNCEMENT_MAX_IMAGES}
              </Text>
            </View>

            {imageCount > 0 ? (
              <View style={styles.imageGrid}>
                {existingImages.map((uri, index) => (
                  <View key={uri} style={styles.imageTile}>
                    <Image source={{ uri }} style={styles.image} resizeMode="cover" />
                    {!submitting ? (
                      <Pressable
                        onPress={() => removeExisting(uri)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove image ${index + 1}`}
                        style={styles.removeImage}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={14} color={Brand.ink} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {pendingImages.map((image, index) => (
                  <View key={image.id} style={styles.imageTile}>
                    <Image source={{ uri: image.uri }} style={styles.image} resizeMode="cover" />
                    {!submitting ? (
                      <Pressable
                        onPress={() => removePending(image.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove selected image ${index + 1}`}
                        style={styles.removeImage}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={14} color={Brand.ink} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            <GhostButton
              label={imageCount === 0 ? 'Add images' : 'Add more'}
              icon="image-outline"
              onPress={() => void addImages()}
              disabled={submitting || imageCount >= ANNOUNCEMENT_MAX_IMAGES}
            />
            <Text style={styles.imageHint}>
              PNG, JPEG, WebP or GIF · up to 5 MB each · {ANNOUNCEMENT_MAX_IMAGES} images maximum.
            </Text>
          </View>

          {uploadProgress ? (
            <View style={styles.progress}>
              <ActivityIndicator size="small" color={Brand.accent} />
              <Text style={styles.progressText}>{uploadProgress}</Text>
            </View>
          ) : null}

          {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}

          <PrimaryButton
            label={editing ? 'Save changes' : 'Publish announcement'}
            icon={editing ? 'save-outline' : 'send-outline'}
            onPress={() => void submit()}
            busy={submitting}
            disabled={!title.trim() || !body.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  loadingWrap: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    gap: 18,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
    backgroundColor: Brand.accentSoft,
  },
  noticeText: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 12,
    lineHeight: 18,
    color: Brand.muted,
  },
  imageLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 7,
  },
  imageLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    color: Brand.muted,
  },
  imageCount: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  imageTile: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: Brand.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  removeImage: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 9, 15, 0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
  },
  imageHint: {
    fontFamily: Type.body,
    fontSize: 10.5,
    lineHeight: 16,
    color: Brand.dim,
    marginTop: 7,
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
    backgroundColor: Brand.accentSoft,
  },
  progressText: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 12,
    color: Brand.muted,
  },
});
