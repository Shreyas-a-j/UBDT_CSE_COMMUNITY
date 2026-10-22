'use client';

/**
 * Compose a real discussion or project showcase. Any authenticated member may
 * publish (the `posts` insert policy requires author_id = auth.uid()); the
 * user's profile is visible on the resulting feed card.
 */

import { useState } from 'react';
import {
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
import { parseTags, sanitizeText } from '@/lib/community';
import { Brand, Type } from '@/lib/theme';
import { BackHeader, Screen } from '@/components/layout';
import { PrimaryButton, StatusBanner, TextField } from '@/components/ui';

type PostType = 'discussion' | 'showcase';

export default function CreatePostScreen() {
  const { session, profile } = useAuth();
  const insets = useSafeAreaInsets();

  const [type, setType] = useState<PostType>('discussion');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [github, setGithub] = useState('');
  const [demo, setDemo] = useState('');
  const [techStack, setTechStack] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length >= 3 && body.trim().length >= 10 && !submitting;

  async function submit() {
    if (!session?.user.id) {
      setError('Your session has expired. Sign in again to publish.');
      return;
    }
    const cleanTitle = sanitizeText(title, 200);
    const cleanBody = sanitizeText(body, 8000);
    if (cleanTitle.length < 3) {
      setError('Give your post a title of at least 3 characters.');
      return;
    }
    if (cleanBody.length < 10) {
      setError('Add at least 10 characters of detail so people can respond.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const { error: writeError } = await supabase.from('posts').insert({
      author_id: session.user.id,
      type,
      title: cleanTitle,
      body: cleanBody,
      image_url: null,
      github_url: type === 'showcase' ? sanitizeText(github, 500) || null : null,
      demo_url: type === 'showcase' ? sanitizeText(demo, 500) || null : null,
      tech_stack: type === 'showcase' ? parseTags(techStack, 12) : [],
      tags: parseTags(tags),
      target_years: [1, 2, 3, 4],
    });

    if (writeError) {
      setError(writeError.message || 'The post could not be published.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    router.back();
  }

  return (
    <Screen bottom>
      <BackHeader title="New post" subtitle={profile?.name ?? 'Publish to the community'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <View style={styles.typeSwitch} accessibilityRole="tablist" accessibilityLabel="Post type">
            {(
              [
                { value: 'discussion' as const, label: 'Discussion', icon: 'chatbubbles-outline' as const },
                { value: 'showcase' as const, label: 'Project showcase', icon: 'sparkles-outline' as const },
              ]
            ).map((option) => {
              const active = type === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setType(option.value)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.typeOption,
                    active && styles.typeOptionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={option.icon}
                    size={15}
                    color={active ? Brand.accent : Brand.dim}
                  />
                  <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextField
            label="Title"
            placeholder={
              type === 'discussion'
                ? 'e.g. How should we prepare for placement DSA rounds?'
                : 'e.g. SmartAtt — QR attendance for CSE labs'
            }
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            editable={!submitting}
            hint={`${title.length}/200`}
          />

          <TextField
            label={type === 'showcase' ? 'What did you build?' : 'Details'}
            placeholder={
              type === 'showcase'
                ? 'Describe the problem, the architecture and what you learned…'
                : 'Add context so people can give you a useful answer…'
            }
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={8000}
            editable={!submitting}
            hint={`${body.length}/8000`}
          />

          {type === 'showcase' ? (
            <View style={styles.showcaseFields}>
              <TextField
                label="GitHub repository"
                placeholder="https://github.com/…"
                value={github}
                onChangeText={setGithub}
                keyboardType="url"
                inputMode="url"
                autoCapitalize="none"
                editable={!submitting}
              />
              <TextField
                label="Live demo"
                placeholder="https://project.example.com"
                value={demo}
                onChangeText={setDemo}
                keyboardType="url"
                inputMode="url"
                autoCapitalize="none"
                editable={!submitting}
              />
              <TextField
                label="Tech stack"
                placeholder="Next.js, Supabase, TypeScript"
                value={techStack}
                onChangeText={setTechStack}
                editable={!submitting}
                hint="Comma separated"
              />
            </View>
          ) : null}

          <TextField
            label="Tags"
            placeholder="DSA, Placements, WebDev"
            value={tags}
            onChangeText={setTags}
            editable={!submitting}
            hint="Comma separated, up to 6"
          />

          {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}

          <View style={styles.actions}>
            <PrimaryButton
              label={type === 'showcase' ? 'Publish showcase' : 'Publish discussion'}
              onPress={() => void submit()}
              busy={submitting}
              disabled={!canSubmit}
            />
            <Text style={styles.note}>
              Posts are visible to the whole department. You can delete your own posts on the website.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    gap: 18,
  },
  typeSwitch: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
  },
  typeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    borderRadius: 7,
  },
  typeOptionActive: {
    backgroundColor: Brand.accentSoft,
  },
  typeLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
    color: Brand.dim,
  },
  typeLabelActive: {
    color: Brand.accent,
  },
  showcaseFields: {
    gap: 18,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
  },
  actions: {
    gap: 12,
    marginTop: 4,
  },
  note: {
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Brand.dim,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
