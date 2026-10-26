import { describe, expect, it } from 'vitest';
import {
  normalizeAdmissionNumber,
  validateAcademicYear,
  validateAdmissionNumber,
  validateStudentSignup,
} from './validation';

const base = {
  name: 'Rahul Sharma',
  email: 'rahul@example.com',
  password: 'secret1',
  confirmPassword: 'secret1',
  usn: '4UB24CS045',
  year: 2,
};

describe('student signup validation', () => {
  it('accepts a year 2 USN', () => {
    expect(validateStudentSignup(base)).toBeNull();
  });

  it('accepts a first-year admission number only', () => {
    expect(
      validateStudentSignup({ ...base, usn: '', year: 1, admissionNumber: 'ADM-2026-001' })
    ).toBeNull();
  });

  it('rejects a first-year student with neither identifier', () => {
    expect(validateStudentSignup({ ...base, usn: '', year: 1 })).toMatch(
      /either a USN or an admission number/i
    );
  });

  it('requires a USN in years 2-4 even with an admission number', () => {
    expect(
      validateStudentSignup({ ...base, usn: '', admissionNumber: 'ADM-2026-001' })
    ).toMatch(/USN is required/i);
  });

  it('rejects an invalid USN or admission number', () => {
    expect(
      validateStudentSignup({
        ...base,
        usn: 'NOPE',
        year: 1,
        admissionNumber: 'ADM-2026-001',
      })
    ).toMatch(/invalid USN/i);
    expect(
      validateStudentSignup({ ...base, usn: '', year: 1, admissionNumber: 'A B' })
    ).toMatch(/valid admission number/i);
  });

  it('normalizes and bounds admission numbers', () => {
    expect(normalizeAdmissionNumber('  adm-2026-001  ')).toBe('ADM-2026-001');
    expect(validateAdmissionNumber('ADM1')).toBe(true);
    expect(validateAdmissionNumber(`A${'B'.repeat(22)}C`)).toBe(true);
    expect(validateAdmissionNumber('AB1')).toBe(false);
    expect(validateAdmissionNumber(`A${'B'.repeat(23)}C`)).toBe(false);
    expect(validateAdmissionNumber('-ABC')).toBe(false);
    expect(validateAdmissionNumber('ABC-')).toBe(false);
  });
});

describe('validateAcademicYear', () => {
  it('accepts 1 through 4', () => {
    for (const year of [1, 2, 3, 4]) {
      expect(validateAcademicYear(year)).toBeNull();
    }
  });

  it('rejects out-of-range, fractional, string and missing values', () => {
    for (const year of [0, 5, 1.5, '2', null, undefined, NaN]) {
      expect(validateAcademicYear(year)).toBe('Select a valid academic year.');
    }
  });
});
