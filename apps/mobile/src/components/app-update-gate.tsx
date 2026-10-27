'use client';

/**
 * Android update gate.
 *
 * The check runs once per process launch. Optional versions are remembered for
 * this session only, so a later launch can prompt again. Mandatory updates
 * block the app until the browser hand-off has happened; they never claim the
 * APK was installed, because Android owns that approval.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { Platform } from 'react-native';

import { AppUpdateDialog } from '@/components/app-update-dialog';
import {
  shouldShowUpdate,
  updatePromptReducer,
} from '@/lib/app-update';
import { checkForAppUpdate, openApkDownload } from '@/lib/app-update-client';

const DOWNLOAD_FAILED_MESSAGE =
  'UCC could not open the download. Check your connection and try again.';

export function AppUpdateGate() {
  const [prompt, dispatch] = useReducer(updatePromptReducer, null);
  const dismissedRef = useRef(new Set<number>());
  const initiatedRef = useRef(new Set<number>());

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let cancelled = false;
    void checkForAppUpdate()
      .then((result) => {
        if (cancelled || result.status !== 'available') return;
        if (
          !shouldShowUpdate(result.update, {
            dismissedVersionCodes: dismissedRef.current,
            initiatedVersionCodes: initiatedRef.current,
          })
        ) {
          return;
        }
        dispatch({ type: 'show', update: result.update });
      })
      .catch((error: unknown) => {
        // A failed update check must never stop the app from opening.
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('UCC update check failed', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLater = useCallback(() => {
    if (!prompt || prompt.phase === 'opening') return;
    if (prompt.update.manifest.mandatory) return;
    dismissedRef.current.add(prompt.update.manifest.versionCode);
    dispatch({ type: 'dismiss' });
  }, [prompt]);

  const handleDownload = useCallback(async () => {
    if (!prompt || prompt.phase === 'opening') return;
    const current = prompt;
    dispatch({ type: 'download-started' });

    try {
      await openApkDownload(current.update.manifest.apkUrl);
      dispatch({ type: 'download-opened' });
    } catch {
      dispatch({ type: 'download-failed', message: DOWNLOAD_FAILED_MESSAGE });
    }
  }, [prompt]);

  const handleContinue = useCallback(() => {
    if (!prompt || prompt.phase !== 'opened') return;
    initiatedRef.current.add(prompt.update.manifest.versionCode);
    dispatch({ type: 'continue' });
  }, [prompt]);

  const handleRequestClose = useCallback(() => {
    if (!prompt) return;
    if (prompt.update.manifest.mandatory) {
      if (prompt.phase === 'opened') handleContinue();
      return;
    }
    handleLater();
  }, [handleContinue, handleLater, prompt]);

  if (!prompt) return null;

  return (
    <AppUpdateDialog
      update={prompt.update}
      phase={prompt.phase}
      error={prompt.error}
      onUpdate={() => void handleDownload()}
      onLater={handleLater}
      onContinue={handleContinue}
      onRequestClose={handleRequestClose}
    />
  );
}
