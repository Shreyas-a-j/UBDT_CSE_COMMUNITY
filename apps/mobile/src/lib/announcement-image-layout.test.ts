import { describe, expect, it } from 'vitest';
import { computeAnnouncementImageLayout } from './announcement-image-layout';

const WIDTH = 360;
const GAP = 6;

describe('computeAnnouncementImageLayout', () => {
  it('gives a single image the full width at its natural ratio', () => {
    const rows = computeAnnouncementImageLayout([1.5], WIDTH, GAP);

    expect(rows).toHaveLength(1);
    expect(rows[0].tiles).toHaveLength(1);
    expect(rows[0].tiles[0].width).toBe(WIDTH);
    expect(rows[0].tiles[0].height).toBeCloseTo(WIDTH / 1.5);
  });

  it('fills one row with two images at a shared height', () => {
    const rows = computeAnnouncementImageLayout([1, 1], WIDTH, GAP);

    expect(rows).toHaveLength(1);
    expect(rows[0].tiles).toHaveLength(2);
    expect(rows[0].tiles[0].width).toBeCloseTo(177);
    expect(rows[0].tiles[1].width).toBeCloseTo(177);
    expect(rows[0].height).toBeCloseTo(177);
  });

  it('preserves each portrait or landscape ratio without cropping', () => {
    const rows = computeAnnouncementImageLayout([0.5, 1.5], WIDTH, GAP);
    const [portrait, landscape] = rows[0].tiles;

    expect(portrait.width / portrait.height).toBeCloseTo(0.5);
    expect(landscape.width / landscape.height).toBeCloseTo(1.5);
    expect(portrait.width + landscape.width + GAP).toBeCloseTo(WIDTH);
  });

  it('lays out three images as a pair followed by a full-width image', () => {
    const rows = computeAnnouncementImageLayout([1, 1, 1], WIDTH, GAP);

    expect(rows).toHaveLength(2);
    expect(rows[0].tiles).toHaveLength(2);
    expect(rows[1].tiles).toHaveLength(1);
    expect(rows[1].tiles[0].width).toBe(WIDTH);
    expect(rows[1].tiles[0].height).toBeCloseTo(WIDTH);
  });

  it('lays out four images as two pairs', () => {
    const rows = computeAnnouncementImageLayout([1, 1, 1, 1], WIDTH, GAP);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.tiles.length)).toEqual([2, 2]);
    for (const row of rows) {
      expect(row.tiles[0].width + row.tiles[1].width + GAP).toBeCloseTo(WIDTH);
      expect(row.tiles[0].height).toBeCloseTo(row.tiles[1].height);
    }
  });

  it('falls back to a square ratio for invalid dimensions', () => {
    const rows = computeAnnouncementImageLayout([0, Number.NaN, -2], WIDTH, GAP);

    for (const row of rows) {
      for (const tile of row.tiles) {
        expect(tile.width / tile.height).toBeCloseTo(1);
      }
    }
  });

  it('returns no rows before the container has been measured', () => {
    expect(computeAnnouncementImageLayout([1, 1], 0, GAP)).toEqual([]);
    expect(computeAnnouncementImageLayout([], WIDTH, GAP)).toEqual([]);
  });
});
