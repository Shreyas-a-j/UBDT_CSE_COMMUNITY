'use client';

/**
 * Sign-in screen — real Supabase credential sign-in against the existing UCC
 * project. Message mapping is unchanged from Milestone 1 / the web app.
 *
 * Layout notes:
 * - The ScrollView uses flexGrow so the form is vertically centred when it
 *   fits and scrolls naturally on small screens or with a large font scale.
 * - The root window uses Android `adjustResize` (see app.json); the focused
 *   field is therefore kept above the keyboard by the native window resize.
 *   No fixed heights or manual keyboard-offset math are used.
 * - Inputs keep focus while typing: they are stable components, and the
 *   "show password" action only toggles `secureTextEntry` in place.
 */

import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { TextInputInstance } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { UCC_WEBSITE_URL } from '@/lib/links';
import { isNetworkError } from '@/lib/supabase';
import { Brand, Type } from '@/lib/theme';
import { validateSignIn } from '@/lib/validation';
import { Subtitle, Wordmark } from '@/components/wordmark';
import { PrimaryButton, StatusBanner, TextField } from '@/components/ui';

type FailureClass = 'credentials' | 'network' | 'other';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInputInstance>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [failureClass, setFailureClass] = useState<FailureClass>('other');
  const [passwordHidden, setPasswordHidden] = useState(true);
  const [websiteError, setWebsiteError] = useState<string | null>(null);

  async function handleSubmit() {
    if (submitting) return;
    setFormError(null);

    const validationMessage = validateSignIn({ email, password });
    if (validationMessage) {
      setFailureClass('other');
      setFormError(validationMessage);
      return;
    }

    setSubmitting(true);
    const failureMessage = await signIn(email, password);
    if (failureMessage) {
      const klass: FailureClass = isNetworkError(failureMessage) ? 'network' : 'credentials';
      setFailureClass(klass);
      setFormError(classFailureCopy(klass, failureMessage));
      setSubmitting(false);
      return;
    }

    // Success: the auth listener updates the session and the root navigator's
    // protected-route guard swaps this screen for the tab shell.
  }

  function openWebsite() {
    setWebsiteError(null);
    void Linking.openURL(UCC_WEBSITE_URL).catch(() => {
      setWebsiteError('Could not open the website. Please try again.');
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <View pointerEvents="none" style={styles.glowTop} />
        <View pointerEvents="none" style={styles.glowBottom} />

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
          contentInsetAdjustmentBehavior="never"
        >
          <View style={styles.hero}>
            <Wordmark size="large" />
            <Subtitle>UBDT CSE Community</Subtitle>
            <Text style={styles.heroTitle} accessibilityRole="header">
              Welcome back
            </Text>
            <Text style={styles.heroCopy}>
              Sign in with the same account you use on the community website. Discussions, events and
              your network are waiting.
            </Text>
          </View>

          <View style={styles.form}>
            <TextField
              label="Institutional email"
              placeholder="name@ubdt.edu.in"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              autoComplete="email"
              textContentType="emailAddress"
              autoCapitalize="none"
              inputMode="email"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!submitting}
              accessibilityLabel="Institutional email"
            />
            <TextField
              ref={passwordRef}
              label="Password"
              secure
              hidden={passwordHidden}
              toggleHidden={() => setPasswordHidden((previous) => !previous)}
              placeholder="At least 6 characters"
              value={password}
              onChangeText={setPassword}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={handleSubmit}
              editable={!submitting}
              accessibilityLabel="Password"
            />

            {formError ? (
              <StatusBanner kind={failureClass === 'network' ? 'warning' : 'error'}>{formError}</StatusBanner>
            ) : null}

            <PrimaryButton
              label="Sign in"
              onPress={handleSubmit}
              busy={submitting}
              disabled={submitting}
            />

            <View style={styles.websiteBlock}>
              <Pressable
                onPress={openWebsite}
                accessibilityRole="link"
                accessibilityLabel="New to UCC? Visit our website"
                accessibilityHint="Opens the UCC website in your browser"
                hitSlop={8}
                style={({ pressed }) => [styles.websiteLink, pressed && styles.websiteLinkPressed]}
              >
                <Text style={styles.websiteLinkText}>
                  New to UCC? <Text style={styles.websiteLinkAction}>Visit our website</Text>
                </Text>
                <Ionicons name="open-outline" size={15} color={Brand.accent} />
              </Pressable>
              {websiteError ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={styles.websiteError}
                >
                  {websiteError}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.footer}>
            <View style={styles.rule} />
            <Text style={styles.footnote}>
              Use the account you registered on the community website. Sessions are kept securely on
              this device, so you stay signed in.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Maps failure classes to the interface's voice — exact parity with the web
 * copy for credential failures, an offline instruction for transport errors,
 * and the raw backend message only when it carries new information.
 */
function classFailureCopy(kind: FailureClass, raw: string): string {
  if (kind === 'network') {
    return 'You appear to be offline. Check your connection and try again.';
  }
  if (kind === 'credentials') return raw;
  return raw || 'Sign in failed. Please try again.';
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Brand.canvas,
  },
  fill: {
    flex: 1,
  },
  glowTop: {
    position: 'absolute',
    top: -120,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: Brand.accentSoft,
    opacity: 0.55,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -160,
    left: -120,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(79, 179, 217, 0.06)',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  hero: {
    marginBottom: 30,
  },
  heroTitle: {
    fontFamily: Type.displayBold,
    fontSize: 30,
    lineHeight: 36,
    color: Brand.chromeInk,
    marginTop: 26,
  },
  heroCopy: {
    fontFamily: Type.body,
    fontSize: 14,
    lineHeight: 21,
    color: Brand.muted,
    marginTop: 8,
    maxWidth: 420,
  },
  form: {
    gap: 18,
  },
  websiteBlock: {
    gap: 4,
  },
  websiteLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  websiteLinkPressed: {
    opacity: 0.6,
  },
  websiteLinkText: {
    flexShrink: 1,
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: Brand.muted,
    textAlign: 'center',
  },
  websiteLinkAction: {
    fontFamily: Type.bodySemiBold,
    color: Brand.accent,
  },
  websiteError: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.error,
    textAlign: 'center',
  },
  footer: {
    marginTop: 32,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Brand.line,
    marginBottom: 18,
  },
  footnote: {
    fontFamily: Type.body,
    fontSize: 12,
    color: Brand.dim,
    lineHeight: 18,
  },
});
