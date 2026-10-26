'use client';

/**
 * Forgot password — sends the same Supabase recovery email as the website.
 *
 * The recovery link points at the website's PKCE callback
 * (`/auth/callback?next=/reset-password`), where the code is exchanged and
 * the password form loads. Native deep links are intentionally not used yet:
 * they would require adding a `ucc://` redirect to the shared Supabase
 * allowlist, which is a backend configuration change.
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/keyboard';
import { supabase } from '@/lib/supabase';
import { isValidEmail } from '@/lib/validation';
import { UCC_WEBSITE_URL } from '@/lib/links';
import { Brand, Type } from '@/lib/theme';
import { Subtitle, Wordmark } from '@/components/wordmark';
import { PrimaryButton, StatusBanner, TextField } from '@/components/ui';

const RESET_REDIRECT = `${UCC_WEBSITE_URL}/auth/callback?next=/reset-password`;

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: RESET_REDIRECT,
    });
    setSubmitting(false);

    if (resetError) {
      setError(resetError.message || 'Could not send the reset link. Please try again.');
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={styles.successIcon}>
            <Ionicons name="mail-outline" size={30} color={Brand.accent} />
          </View>
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successCopy}>
            If an account exists for {email.trim()}, we sent a link to reset the password. Follow
            it to the website, set a new password, then return here and sign in.
          </Text>
          <View style={styles.successAction}>
            <PrimaryButton
              label="Back to sign in"
              icon="arrow-back-outline"
              onPress={() => router.replace('/sign-in')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={KEYBOARD_AVOIDING_BEHAVIOR} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Math.max(24, insets.top + 12),
              paddingBottom: Math.max(24, insets.bottom + 20),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Wordmark size="large" />
            <Subtitle>UBDT CSE Community</Subtitle>
            <Text style={styles.heroTitle}>Reset your password</Text>
            <Text style={styles.heroCopy}>
              Enter your email and we will send you a reset link. The link opens the community
              website’s secure reset form.
            </Text>
          </View>

          <View style={styles.form}>
            <TextField
              label="Email address"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="email"
              editable={!submitting}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />

            {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}

            <PrimaryButton
              label="Send reset link"
              icon="paper-plane-outline"
              onPress={() => void submit()}
              busy={submitting}
              disabled={submitting}
            />
          </View>

          <Pressable
            onPress={() => router.replace('/sign-in')}
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
            hitSlop={8}
            style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={14} color={Brand.accent} />
            <Text style={styles.backLinkText}>Back to sign in</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Brand.canvas,
  },
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  hero: {
    marginBottom: 28,
  },
  heroTitle: {
    fontFamily: Type.displayBold,
    fontSize: 28,
    lineHeight: 34,
    color: Brand.chromeInk,
    marginTop: 22,
  },
  heroCopy: {
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Brand.muted,
    marginTop: 7,
    maxWidth: 420,
  },
  form: {
    gap: 18,
  },
  backLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    marginTop: 18,
    paddingHorizontal: 12,
  },
  backLinkText: {
    fontFamily: Type.bodyMedium,
    fontSize: 13,
    color: Brand.accent,
  },
  pressed: {
    opacity: 0.65,
  },
  successContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}66`,
    marginBottom: 18,
  },
  successTitle: {
    fontFamily: Type.displayBold,
    fontSize: 24,
    color: Brand.chromeInk,
    textAlign: 'center',
  },
  successCopy: {
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 21,
    color: Brand.muted,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 380,
  },
  successAction: {
    alignSelf: 'stretch',
    marginTop: 26,
  },
});
