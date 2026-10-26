/**
 * Justified layout for announcement images.
 *
 * Every tile keeps the image's natural aspect ratio: no cropping and no
 * letterbox gutters. Each row is given a shared height and the widths are
 * solved so the row fills the card exactly, minus the fixed gaps.
 */

export interface AnnouncementImageTile {
  /** Index into the announcement's image_urls array. */
  index: number;
  width: number;
  height: number;
}

export interface AnnouncementImageRow {
  tiles: AnnouncementImageTile[];
  height: number;
}

function safeAspect(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Pair images into rows. One or two images stay on one row; three images use
 * a pair plus a full-width image; four images use two pairs.
 */
function rowIndices(count: number): number[][] {
  if (count <= 2) {
    return [Array.from({ length: count }, (_, index) => index)];
  }
  if (count === 3) {
    return [
      [0, 1],
      [2],
    ];
  }

  const rows: number[][] = [];
  for (let index = 0; index < count; index += 2) {
    rows.push(
      index + 1 < count ? [index, index + 1] : [index]
    );
  }
  return rows;
}

export function computeAnnouncementImageLayout(
  aspects: number[],
  containerWidth: number,
  gap: number
): AnnouncementImageRow[] {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0 || aspects.length === 0) {
    return [];
  }

  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;

  return rowIndices(aspects.length).map((indices) => {
    const available = Math.max(0, containerWidth - safeGap * (indices.length - 1));
    const ratios = indices.map((index) => safeAspect(aspects[index]));
    const ratioSum = ratios.reduce((sum, ratio) => sum + ratio, 0);
    const height = ratioSum > 0 ? available / ratioSum : 0;

    let used = 0;
    const tiles = indices.map((index, position) => {
      const width =
        position === indices.length - 1
          ? available - used
          : height * ratios[position];
      used += width;
      return { index, width, height };
    });

    return { tiles, height };
  });
}
