import { describe, expect, it } from 'vitest';

import {
  HIDDEN_NOTIFICATION_FILTER,
  HIDDEN_NOTIFICATION_TYPES,
  isNotificationVisible,
} from './notifications';
import { canExportCommunityActivity, isApprovedFaculty } from './profile';

describe('removed messaging/connection notifications', () => {
  it('filters every obsolete notification type server-side', () => {
    expect(HIDDEN_NOTIFICATION_TYPES).toEqual([
      'message',
      'connection_request',
      'connection_accepted',
    ]);
    expect(HIDDEN_NOTIFICATION_FILTER).toBe('(message,connection_request,connection_accepted)');
  });

  it('hides legacy rows while keeping real community notifications', () => {
    expect(isNotificationVisible('message')).toBe(false);
    expect(isNotificationVisible('connection_request')).toBe(false);
    expect(isNotificationVisible('connection_accepted')).toBe(false);
    expect(isNotificationVisible('event_rsvp')).toBe(true);
    expect(isNotificationVisible('post_comment')).toBe(true);
  });

  it('never treats a missing or non-string type as visible', () => {
    expect(isNotificationVisible(undefined)).toBe(false);
    expect(isNotificationVisible(null)).toBe(false);
    expect(isNotificationVisible('')).toBe(false);
    expect(isNotificationVisible(7)).toBe(false);
  });
});

describe('community activity export authorization (display gate)', () => {
  it('requires faculty/admin AND an approved database status, matching the server', () => {
    expect(canExportCommunityActivity({ role: 'faculty', faculty_status: 'approved' })).toBe(true);
    expect(canExportCommunityActivity({ role: 'faculty', faculty_status: 'verified' })).toBe(true);
    expect(canExportCommunityActivity({ role: 'admin', faculty_status: 'approved' })).toBe(true);
  });

  it('denies pending, rejected, missing and student profiles', () => {
    expect(canExportCommunityActivity({ role: 'faculty', faculty_status: 'pending' })).toBe(false);
    expect(canExportCommunityActivity({ role: 'faculty', faculty_status: 'rejected' })).toBe(false);
    expect(canExportCommunityActivity({ role: 'admin', faculty_status: 'none' })).toBe(false);
    expect(canExportCommunityActivity({ role: 'student', faculty_status: 'approved' })).toBe(false);
    expect(canExportCommunityActivity(null)).toBe(false);
  });

  it('keeps publish gating broader than export gating (admins may publish)', () => {
    expect(isApprovedFaculty({ role: 'admin', faculty_status: 'none' })).toBe(true);
    expect(canExportCommunityActivity({ role: 'admin', faculty_status: 'none' })).toBe(false);
  });
});
