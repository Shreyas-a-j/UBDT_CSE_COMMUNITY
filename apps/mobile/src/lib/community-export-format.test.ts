import { describe, expect, it } from 'vitest';

import {
  filenameFromContentDisposition,
  normalizedHeaders,
  safeCsvFilename,
  sixMonthWindow,
  sixMonthWindowLabel,
} from './community-export-format';

describe('CSV filename parsing', () => {
  it('reads quoted, token and RFC 5987 filenames', () => {
    expect(filenameFromContentDisposition('attachment; filename="ucc.csv"')).toBe('ucc.csv');
    expect(filenameFromContentDisposition('attachment; filename=ucc.csv')).toBe('ucc.csv');
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''ucc%20activity.csv")
    ).toBe('ucc activity.csv');
  });

  it('returns null when no filename is present', () => {
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition('attachment')).toBeNull();
    expect(filenameFromContentDisposition('   ')).toBeNull();
  });
});

describe('safe CSV filenames', () => {
  it('reduces a path to a single safe segment and keeps the csv extension', () => {
    expect(safeCsvFilename('../../etc/passwd')).toBe('passwd.csv');
    expect(safeCsvFilename('C:\\Users\\me\\report.CSV')).toBe('report.CSV');
    expect(safeCsvFilename('community activity (Oct).csv')).toBe('community-activity-Oct-.csv');
  });

  it('appends .csv when missing and falls back when empty', () => {
    expect(safeCsvFilename('activity')).toBe('activity.csv');
    expect(safeCsvFilename('')).toBe('ucc-community-activity.csv');
    expect(safeCsvFilename('///')).toBe('ucc-community-activity.csv');
    expect(safeCsvFilename(null)).toBe('ucc-community-activity.csv');
  });

  it('strips control characters and caps the length', () => {
    expect(safeCsvFilename('a\u0000b.csv')).toBe('a-b.csv');
    const long = safeCsvFilename(`${'x'.repeat(300)}.csv`);
    expect(long.length).toBeLessThanOrEqual(124);
    expect(long.endsWith('.csv')).toBe(true);
  });
});

describe('searched six-month window label', () => {
  it('names the same six-calendar-month span the server queries', () => {
    expect(sixMonthWindow(new Date('2026-10-24T00:00:00.000Z'))).toEqual({
      startDate: '2026-04-24',
      endDate: '2026-10-24',
    });
    expect(sixMonthWindowLabel(new Date('2026-10-24T00:00:00.000Z'))).toBe(
      '2026-04-24 to 2026-10-24'
    );
  });

  it('clamps the start to the last real day of the target month', () => {
    expect(sixMonthWindow(new Date('2026-08-31T00:00:00.000Z'))).toEqual({
      startDate: '2026-02-28',
      endDate: '2026-08-31',
    });
    expect(sixMonthWindow(new Date('2028-08-31T00:00:00.000Z')).startDate).toBe('2028-02-29');
    expect(sixMonthWindow(new Date('2026-03-31T00:00:00.000Z')).startDate).toBe('2025-09-30');
  });
});

describe('header normalization', () => {
  it('lower-cases keys and drops non-string values', () => {
    expect(
      normalizedHeaders({
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="x.csv"',
      })
    ).toEqual({
      'content-type': 'text/csv',
      'content-disposition': 'attachment; filename="x.csv"',
    });

    expect(normalizedHeaders(null)).toEqual({});
  });
});
