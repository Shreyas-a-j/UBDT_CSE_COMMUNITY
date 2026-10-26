/**
 * Resolve remote announcement images to aspect ratios before they render.
 *
 * Dimensions are cached per URL so scrolling a list does not refetch them.
 * Until every image is measured the card shows a quiet placeholder rather
 * than a crop that jumps when the real ratio arrives.
 */
import { useEffect, useState } from 'react';
import { Image } from 'react-native';

const aspectCache = new Map<string, number>();

function normalizeAspect(width: number, height: number): number {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 1;
}

function cachedAspects(urls: string[]): number[] | null {
  const values = urls.map((url) => aspectCache.get(url));
  return values.every((value): value is number => typeof value === 'number') ? values : null;
}

export function useAnnouncementImageAspects(urls: string[]): number[] | null {
  const [resolved, setResolved] = useState<{ key: string; aspects: number[] } | null>(() => {
    const known = cachedAspects(urls);
    return known ? { key: urls.join('\n'), aspects: known } : null;
  });

  const key = urls.join('\n');

  useEffect(() => {
    let cancelled = false;
    const currentKey = urls.join('\n');

    Promise.all(
      urls.map(
        (url) =>
          new Promise<number>((resolve) => {
            const known = aspectCache.get(url);
            if (typeof known === 'number') {
              resolve(known);
              return;
            }

            Image.getSize(
              url,
              (width, height) => {
                const aspect = normalizeAspect(width, height);
                aspectCache.set(url, aspect);
                resolve(aspect);
              },
              () => {
                aspectCache.set(url, 1);
                resolve(1);
              }
            );
          })
      )
    ).then((aspects) => {
      if (!cancelled) setResolved({ key: currentKey, aspects });
    });

    return () => {
      cancelled = true;
    };
  }, [urls]);

  const immediate = cachedAspects(urls);
  if (immediate) return immediate;
  return resolved?.key === key ? resolved.aspects : null;
}
