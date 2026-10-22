/**
 * Supabase client for React Native.
 *
 * Deliberately different from the web clients: `lib/supabase/client.ts` on the
 * web uses `@supabase/ssr`'s browser cookie storage, which cannot run in
 * React Native. Here we use plain `@supabase/supabase-js` (same 2.x major as
 * the web) with `expo-secure-store` as the persistence adapter.
 *
 * Why expo-secure-store: on Android values live in EncryptedSharedPreferences
 * backed by Android Keystore, so refresh tokens are never written in
 * plaintext app-private storage. Expo itself enforces no size limit on
 * Android (per SDK 58 docs); the historical ~2KB caveat is iOS Keychain only.
 *
 * The anon key is a public client key by design (RLS is the boundary).
 * No service-role key is ever referenced from mobile.
 */

import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Check EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env (see .env.example).'
  );
}

/** SecureStore-backed Supabase storage adapter (AsyncStorage-compatible API). */
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // Sessions are restored from secure storage, never from a URL (no web
    // deep-link confirm flows in Milestone 1).
    detectSessionInUrl: false,
  },
});

/**
 * Classifies transport-level failures so the UI can show a network-error
 * state instead of a generic failure. Covers the React Native fetch message
 * variants ("Network request failed") and common timeout phrasing.
 */
export function isNetworkError(message: string | null | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return [
    'network request failed',
    'networkerror',
    'failed to fetch',
    'fetch failed',
    'timeout',
    'timed out',
    'unable to resolve host',
  ].some((needle) => normalized.includes(needle));
}
