'use client';

/**
 * Edit profile — same editable fields as the website's ProfileModal:
 * name, bio, skills and the three optional public links. USN, role,
 * designation and member identity are immutable in the database and are not
 * offered here.
 *
 * Avatar changes stay on the website for now: the R2 upload route is bound to
 * the website's cookie session and server secret. The current avatar is shown
 * for context but never overwritten by this screen.
 */

import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/keyboard';
import { supabase } from '@/lib/supabase';
import {
  alumniTag,
  normalizeProfileLinks,
  type ProfileLinkErrors,
  type ProfileLinkField,
} from '@/lib/profile';
import { validateAcademicYear, validateUSN } from '@/lib/validation';
import { Brand, Radius, Type } from '@/lib/theme';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { BackHeader, Screen } from '@/components/layout';
import { EmptyState } from '@/components/states';
import { GhostButton, PrimaryButton, StatusBanner, TextField } from '@/components/ui';

const LINK_FIELDS: {
  field: ProfileLinkField;
  label: string;
  placeholder: string;
  hint: string;
}[] = [
  {
    field: 'portfolio_url',
    label: 'Portfolio URL',
    placeholder: 'https://your-site.dev',
    hint: 'Optional. Bare domains are saved as HTTPS links.',
  },
  {
    field: 'github_url',
    label: 'GitHub URL',
    placeholder: 'github.com/username',
    hint: 'Must point to github.com.',
  },
  {
    field: 'linkedin_url',
    label: 'LinkedIn URL',
    placeholder: 'linkedin.com/in/username',
    hint: 'Must point to linkedin.com.',
  },
];

export default function EditProfileScreen() {
  const { profile, updateProfile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(profile?.name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [year, setYear] = useState<number | null>(profile?.year ?? null);
  const [yearSync, setYearSync] = useState<{ id: string; year: number | null } | null>(
    profile?.id ? { id: profile.id, year: profile.year ?? null } : null,
  );
  const [skills, setSkills] = useState<string[]>(profile?.skills ?? []);
  const [skillDraft, setSkillDraft] = useState('');
  const [portfolio, setPortfolio] = useState(profile?.portfolio_url ?? '');
  const [github, setGithub] = useState(profile?.github_url ?? '');
  const [linkedin, setLinkedin] = useState(profile?.linkedin_url ?? '');
  const [linkErrors, setLinkErrors] = useState<ProfileLinkErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [usnDraft, setUsnDraft] = useState('');
  const [usnError, setUsnError] = useState<string | null>(null);
  const [usnPending, setUsnPending] = useState(false);
  const [admissionNumber, setAdmissionNumber] = useState<string | null>(null);

  // The profile can arrive after this screen mounts (or change after a
  // refresh). Adjust the year chip during render, keyed only on the loaded
  // row's id/year, so unrelated profile fields never clobber an edit. This
  // is React's guarded render-time sync pattern; a setState-in-effect here
  // would render a stale year first and trip react-hooks/set-state-in-effect.
  if (profile?.id) {
    const nextYear = profile.year ?? null;
    if (!yearSync || yearSync.id !== profile.id || yearSync.year !== nextYear) {
      setYearSync({ id: profile.id, year: nextYear });
      setYear(nextYear);
    }
  }

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;

    void supabase
      .from('student_admission_numbers')
      .select('admission_number')
      .eq('profile_id', profile.id)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        // Hide the row when the additive migration has not been applied yet.
        if (!active || queryError) return;
        setAdmissionNumber(
          typeof data?.admission_number === 'string' ? data.admission_number : null,
        );
      });

    return () => {
      active = false;
    };
  }, [profile?.id]);

  if (!profile) {
    return (
      <Screen bottom>
        <BackHeader title="Edit profile" />
        <EmptyState
          icon="person-circle-outline"
          title="Profile not ready"
          message="Your community profile could not be read, so there is nothing to edit yet."
          action={<GhostButton label="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const addSkill = () => {
    const next = skillDraft.trim();
    if (!next) return;
    if (!skills.some((skill) => skill.toLowerCase() === next.toLowerCase())) {
      setSkills((previous) => [...previous, next]);
    }
    setSkillDraft('');
  };

  const removeSkill = (skill: string) => {
    setSkills((previous) => previous.filter((value) => value !== skill));
  };

  const linkUsn = async () => {
    if (usnPending) return;
    const normalized = usnDraft.trim().toUpperCase();
    if (!validateUSN(normalized)) {
      setUsnError('Enter a valid USN. Expected format: 4UB24CS045');
      return;
    }

    setUsnPending(true);
    setUsnError(null);
    const { error: linkError } = await supabase.rpc('link_student_usn', { p_usn: normalized });
    setUsnPending(false);

    if (linkError) {
      const message = linkError.message.toLowerCase();
      setUsnError(
        message.includes('already registered')
          ? 'This USN is already registered. Sign in or contact the administrator.'
          : message.includes('already linked')
            ? 'A USN is already linked to this account.'
            : message.includes('only students')
              ? 'Only students can link a USN.'
              : 'Could not link the USN. Check the format and try again.',
      );
      return;
    }

    setUsnDraft('');
    await refreshProfile();
  };

  const save = async () => {
    if (saving) return;
    const cleanName = name.trim();
    if (cleanName.length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }

    const isStudent = profile.member_type === 'student';
    if (isStudent) {
      const yearFailure = validateAcademicYear(year);
      if (yearFailure) {
        setError(yearFailure);
        return;
      }
    }

    const links = normalizeProfileLinks({
      portfolio_url: portfolio,
      github_url: github,
      linkedin_url: linkedin,
    });
    if (Object.keys(links.errors).length > 0) {
      setLinkErrors(links.errors);
      setError('Fix the highlighted links before saving.');
      return;
    }

    setLinkErrors({});
    setError(null);
    setSaving(true);
    const failure = await updateProfile({
      name: cleanName,
      bio: bio.trim(),
      skills,
      ...(isStudent ? { year } : {}),
      ...links.values,
    });
    setSaving(false);

    if (failure) {
      setError(failure);
      return;
    }
    router.back();
  };

  return (
    <Screen bottom>
      <BackHeader title="Edit profile" subtitle="Changes appear everywhere immediately" />
      <KeyboardAvoidingView behavior={KEYBOARD_AVOIDING_BEHAVIOR} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 20) + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <View style={styles.identity}>
            <Avatar name={profile.name} uri={profile.avatar_url} size={64} />
            <View style={styles.identityText}>
              <View style={styles.identityNameRow}>
                <Text style={styles.identityName}>{profile.name}</Text>
                {profile.member_type === 'alumni' ? (
                  <Badge label={alumniTag(profile.graduation_year)} tone="warn" />
                ) : null}
              </View>
              <Text style={styles.identityMeta}>
                {[profile.usn, profile.branch].filter(Boolean).join(' · ')}
              </Text>
              <Text style={styles.avatarNote}>
                Change your avatar on the community website.
              </Text>
            </View>
          </View>

          {profile.member_type === 'student' && profile.usn == null ? (
            <View style={styles.usnSection}>
              <TextField
                label="Add your USN"
                value={usnDraft}
                onChangeText={(value) => {
                  setUsnDraft(value.toUpperCase());
                  setUsnError(null);
                }}
                placeholder="e.g. 4UB24CS045"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                editable={!usnPending && !saving}
                error={usnError}
                hint="You can link a USN once. It cannot be changed later."
              />
              <PrimaryButton
                label="Link USN"
                icon="link-outline"
                onPress={() => void linkUsn()}
                busy={usnPending}
                disabled={!usnDraft.trim() || saving}
              />
            </View>
          ) : null}

          {admissionNumber ? (
            <View style={styles.admissionRow}>
              <Text style={styles.admissionLabel}>Admission number on file</Text>
              <Text style={styles.admissionValue}>{admissionNumber}</Text>
            </View>
          ) : null}

          <TextField
            label="Full name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Varun Kumar"
            maxLength={120}
            editable={!saving}
            hint={`${name.length}/120`}
          />

          <TextField
            label="Bio and interests"
            value={bio}
            onChangeText={setBio}
            placeholder="What are you working on?"
            multiline
            maxLength={1000}
            editable={!saving}
            hint={`${bio.length}/1000`}
          />

          {profile.member_type === 'student' ? (
            <View>
              <Text style={styles.label}>Academic year</Text>
              <View style={styles.yearRow}>
                {[1, 2, 3, 4].map((value) => {
                  const selected = year === value;
                  const label = ['1st', '2nd', '3rd', '4th'][value - 1];
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setYear(value)}
                      disabled={saving}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: saving }}
                      accessibilityLabel={`${label} year`}
                      style={({ pressed }) => [
                        styles.yearChip,
                        selected && styles.yearChipSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[styles.yearChipText, selected && styles.yearChipTextSelected]}
                      >
                        {label} year
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View>
            <Text style={styles.label}>Skills and technologies</Text>
            {skills.length === 0 ? (
              <Text style={styles.emptyNote}>No skills added yet.</Text>
            ) : (
              <View style={styles.skillList}>
                {skills.map((skill) => (
                  <View key={skill} style={styles.skill}>
                    <Text style={styles.skillText}>{skill}</Text>
                    <Pressable
                      onPress={() => removeSkill(skill)}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${skill}`}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={14} color={Brand.dim} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.skillComposer}>
              <TextInput
                value={skillDraft}
                onChangeText={setSkillDraft}
                placeholder="Add a skill, e.g. React or C++"
                placeholderTextColor={Brand.dim}
                style={styles.skillInput}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={addSkill}
                selectionColor={Brand.accent}
                accessibilityLabel="Add a skill"
                editable={!saving}
              />
              <Pressable
                onPress={addSkill}
                disabled={!skillDraft.trim() || saving}
                accessibilityRole="button"
                accessibilityLabel="Add skill"
                style={({ pressed }) => [
                  styles.addSkill,
                  (!skillDraft.trim() || saving) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="add" size={18} color={Brand.accent} />
              </Pressable>
            </View>
          </View>

          <View style={styles.linksSection}>
            <Text style={styles.sectionTitle}>Public links</Text>
            <Text style={styles.sectionCopy}>
              Optional. Bare domains like github.com/you are saved as HTTPS links.
            </Text>

            {LINK_FIELDS.map((definition) => (
              <TextField
                key={definition.field}
                label={definition.label}
                value={
                  definition.field === 'portfolio_url'
                    ? portfolio
                    : definition.field === 'github_url'
                      ? github
                      : linkedin
                }
                onChangeText={(value) => {
                  if (definition.field === 'portfolio_url') setPortfolio(value);
                  else if (definition.field === 'github_url') setGithub(value);
                  else setLinkedin(value);
                  if (linkErrors[definition.field]) {
                    setLinkErrors((previous) => ({
                      ...previous,
                      [definition.field]: undefined,
                    }));
                  }
                }}
                placeholder={definition.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!saving}
                error={linkErrors[definition.field] ?? null}
                hint={definition.hint}
              />
            ))}
          </View>

          {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}

          <View style={styles.actions}>
            <GhostButton
              label="Cancel"
              onPress={() => router.back()}
              disabled={saving}
            />
            <View style={styles.save}>
              <PrimaryButton
                label="Save changes"
                icon="save-outline"
                onPress={() => void save()}
                busy={saving}
                disabled={!name.trim()}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 6,
    gap: 18,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  identityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  identityName: {
    fontFamily: Type.display,
    fontSize: 18,
    color: Brand.ink,
  },
  identityMeta: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    marginTop: 2,
  },
  avatarNote: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
    marginTop: 6,
  },
  label: {
    fontFamily: Type.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Brand.dim,
    marginBottom: 9,
  },
  usnSection: {
    gap: 10,
    padding: 14,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
  },
  admissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
  },
  admissionLabel: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.muted,
  },
  admissionValue: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.5,
    color: Brand.ink,
  },
  emptyNote: {
    fontFamily: Type.body,
    fontSize: 12,
    color: Brand.dim,
    marginBottom: 9,
  },
  skillList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 10,
  },
  skill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  skillText: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.muted,
  },
  skillComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  skillInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: Type.body,
    fontSize: 13.5,
    color: Brand.ink,
  },
  addSkill: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}66`,
    backgroundColor: Brand.accentSoft,
  },
  yearRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  yearChip: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: Brand.elevated,
  },
  yearChipSelected: {
    borderColor: `${Brand.accent}99`,
    backgroundColor: Brand.accentSoft,
  },
  yearChipText: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    color: Brand.muted,
  },
  yearChipTextSelected: {
    color: Brand.accent,
  },
  linksSection: {
    gap: 14,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  sectionTitle: {
    fontFamily: Type.bodySemiBold,
    fontSize: 13.5,
    color: Brand.ink,
  },
  sectionCopy: {
    marginTop: -8,
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Brand.dim,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  save: {
    flex: 1,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.7,
  },
});
