'use client';

import { router, useLocalSearchParams } from 'expo-router';

import { AnnouncementComposer } from '@/components/announcement-composer';
import { BackHeader, Screen } from '@/components/layout';
import { EmptyState } from '@/components/states';
import { GhostButton } from '@/components/ui';

export default function EditAnnouncementScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  if (typeof id !== 'string' || id.length === 0) {
    return (
      <Screen bottom>
        <BackHeader title="Edit announcement" subtitle="Faculty workspace" />
        <EmptyState
          icon="alert-circle-outline"
          title="Announcement unavailable"
          message="The announcement link is missing an identifier."
          action={<GhostButton label="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  return <AnnouncementComposer announcementId={id} />;
}
