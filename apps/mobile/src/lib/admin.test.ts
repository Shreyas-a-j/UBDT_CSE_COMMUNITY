import { describe, expect, it } from 'vitest';
import {
  adminActionLabel,
  isEligibleAdminNominee,
  nominationStatusLabel,
} from './admin';

const eligible = {
  id: 'fac-1',
  role: 'faculty',
  faculty_status: 'approved',
  member_type: 'faculty',
};

describe('isEligibleAdminNominee', () => {
  it('accepts approved and verified faculty', () => {
    expect(isEligibleAdminNominee(eligible, 'admin-1')).toBe(true);
    expect(
      isEligibleAdminNominee({ ...eligible, faculty_status: 'verified' }, 'admin-1')
    ).toBe(true);
  });

  it('rejects the current administrator (self-nomination)', () => {
    expect(isEligibleAdminNominee(eligible, 'fac-1')).toBe(false);
  });

  it('rejects non-faculty roles and pending/rejected faculty', () => {
    expect(isEligibleAdminNominee({ ...eligible, role: 'student' }, 'admin-1')).toBe(false);
    expect(isEligibleAdminNominee({ ...eligible, role: 'admin' }, 'admin-1')).toBe(false);
    expect(isEligibleAdminNominee({ ...eligible, faculty_status: 'pending' }, 'admin-1')).toBe(false);
    expect(isEligibleAdminNominee({ ...eligible, faculty_status: 'rejected' }, 'admin-1')).toBe(false);
  });

  it('rejects alumni, students and missing identities', () => {
    expect(isEligibleAdminNominee({ ...eligible, member_type: 'student' }, 'admin-1')).toBe(false);
    expect(isEligibleAdminNominee({ ...eligible, member_type: 'alumni' }, 'admin-1')).toBe(false);
    expect(isEligibleAdminNominee(null, 'admin-1')).toBe(false);
    expect(isEligibleAdminNominee({ ...eligible, id: null }, 'admin-1')).toBe(false);
  });
});

describe('nominationStatusLabel', () => {
  it('labels every known state', () => {
    expect(nominationStatusLabel('pending')).toBe('Awaiting nominee response');
    expect(nominationStatusLabel('accepted')).toBe('Accepted');
    expect(nominationStatusLabel('declined')).toBe('Declined');
    expect(nominationStatusLabel('cancelled')).toBe('Cancelled');
    expect(nominationStatusLabel('something-else')).toBe('Unknown');
  });
});

describe('adminActionLabel', () => {
  it('turns audit action codes into readable labels', () => {
    expect(adminActionLabel('nomination_created')).toBe('nomination created');
    expect(adminActionLabel('admin_transfer')).toBe('admin transfer');
  });
});
