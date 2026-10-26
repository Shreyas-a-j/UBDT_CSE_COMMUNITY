/**
 * Pure administrator-succession helpers shared by the mobile handover card
 * and the nominee banner.
 *
 * These only decide what the UI offers. The SECURITY DEFINER RPCs re-check the
 * caller, the nominee and the single-pending-nomination rule.
 */

export interface AdminNominee {
  id: string;
  name: string;
  usn: string | null;
  designation: string | null;
}

export function isEligibleAdminNominee(
  profile:
    | {
        id?: string | null;
        role?: unknown;
        faculty_status?: unknown;
        member_type?: unknown;
      }
    | null
    | undefined,
  currentAdminId: string | null | undefined
): boolean {
  if (!profile?.id || profile.id === currentAdminId) return false;
  return (
    profile.role === 'faculty' &&
    (profile.faculty_status === 'approved' || profile.faculty_status === 'verified') &&
    profile.member_type === 'faculty'
  );
}

export function nominationStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Awaiting nominee response';
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

/** Short audit action label: `nomination_created` → `nomination created`. */
export function adminActionLabel(action: string): string {
  return action.replaceAll('_', ' ');
}
