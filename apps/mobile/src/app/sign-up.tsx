'use client';

/**
 * Registration — mobile port of the website's canonical auth page
 * (`/signin?mode=signup&role=...`).
 *
 * All three flows call the same public Supabase `signUp` API with the same
 * metadata the website sends. No privileged fields are included: the database
 * trigger provisions the profile and, for faculty, the pending application.
 * RLS and database triggers remain the authority.
 *
 * Email confirmation is handled exactly like the website: when Supabase
 * returns no usable session, the screen shows a "check your email" state.
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/keyboard';
import { supabase } from '@/lib/supabase';
import { logSupabaseError } from '@/lib/errors';
import {
  buildFacultyApplicationRow,
  buildFacultySignupMetadata,
  classifyFacultyApplicationInsert,
} from '@/lib/faculty';
import {
  getYearFromUSN,
  parseTagList,
  validateAlumniSignup,
  validateFacultySignup,
  validateStudentSignup,
} from '@/lib/validation';
import { Brand, Radius, Type } from '@/lib/theme';
import { Subtitle, Wordmark } from '@/components/wordmark';
import { FilterChips } from '@/components/segmented';
import { PrimaryButton, StatusBanner, TextField } from '@/components/ui';
type SignupRole = 'student' | 'alumni' | 'faculty';

const ROLE_OPTIONS: { value: SignupRole; label: string }[] = [
  { value: 'student', label: 'Student' },
  { value: 'alumni', label: 'Alumni' },
  { value: 'faculty', label: 'Faculty' },
];

type SuccessKind = 'confirm-email' | 'faculty-pending' | null;

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();

  const [role, setRole] = useState<SignupRole>('student');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [usn, setUsn] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [year, setYear] = useState(1);
  const [graduationYear, setGraduationYear] = useState(String(new Date().getFullYear()));
  const [section, setSection] = useState('');
  const [skills, setSkills] = useState('');
  const [department, setDepartment] = useState('CSE');
  const [designation, setDesignation] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordHidden, setPasswordHidden] = useState(true);
  const [confirmHidden, setConfirmHidden] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessKind>(null);

  const updateUsn = (value: string) => {
    const upper = value.toUpperCase().trim();
    setUsn(upper);
    const detected = getYearFromUSN(upper);
    if (detected) {
      setYear(detected);
      setAdmissionNumber('');
    } else if (!upper) {
      // No USN: a first-year student may use an admission number instead.
      setYear(1);
      setAdmissionNumber('');
    }
  };

  const changeRole = (next: SignupRole) => {
    if (submitting) return;
    setRole(next);
    setError(null);
    setSuccess(null);
  };

  const submitStudent = async () => {
    const validationError = validateStudentSignup({
      name,
      email,
      password,
      confirmPassword,
      usn,
      admissionNumber,
      year,
      section,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    const formattedUsn = usn.toUpperCase().trim();

    // Early, friendly USN feedback. The database unique constraint remains
    // authoritative; a failed probe does not block registration. Admission-only
    // first-year signup skips the probe.
    if (formattedUsn) {
      const { data: existing, error: usnError } = await supabase
        .from('profiles')
        .select('id')
        .eq('usn', formattedUsn)
        .maybeSingle();
      if (usnError) {
        logSupabaseError('USN availability probe failed (continuing)', usnError);
      } else if (existing) {
        setError('This USN is already registered. Please sign in or contact the administrator.');
        return;
      }
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          name: name.trim(),
          usn: formattedUsn || null,
          ...(!formattedUsn && year === 1 && admissionNumber.trim()
            ? { admission_number: admissionNumber.trim().toUpperCase() }
            : {}),
          year,
          department: 'CSE',
          section: section.trim() || null,
          skills: parseTagList(skills),
          intent: 'student',
        },
      },
    });

    if (signUpError) {
      setError(friendlySignupError(signUpError.message));
      return;
    }

    if (!data.user) {
      setSuccess('confirm-email');
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setSuccess('confirm-email');
      return;
    }
    // The auth listener swaps the navigator to the tab shell.
  };

  const submitAlumni = async () => {
    const parsedGraduationYear = Number(graduationYear);
    const validationError = validateAlumniSignup({
      name,
      email,
      password,
      confirmPassword,
      graduationYear: parsedGraduationYear,
      section,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          name: name.trim(),
          department: 'CSE',
          section: section.trim() || null,
          skills: parseTagList(skills),
          intent: 'alumni',
          graduation_year: parsedGraduationYear,
        },
      },
    });

    if (signUpError) {
      setError(friendlySignupError(signUpError.message));
      return;
    }

    if (!data.user) {
      setSuccess('confirm-email');
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setSuccess('confirm-email');
      return;
    }
  };

  const submitFaculty = async () => {
    const validationError = validateFacultySignup({
      name,
      email,
      password,
      confirmPassword,
      designation,
      department,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: buildFacultySignupMetadata({
          name,
          department,
          designation,
          employeeId,
        }),
      },
    });

    if (signUpError) {
      setError(friendlySignupError(signUpError.message));
      return;
    }

    const userId = authData.user?.id;
    if (!userId) {
      setError(
        'Your account could not be created, so no application was saved. Please try again or contact support.'
      );
      return;
    }

    // Supabase obfuscates an already-registered address: signUp can return a
    // user with an empty identities array and no error. Never claim success
    // for an account that was not created.
    if (Array.isArray(authData.user?.identities) && authData.user.identities.length === 0) {
      setError(
        'This email is already registered. Sign in with that account, or contact an administrator to request faculty access.'
      );
      return;
    }

    if (!authData.session) {
      // The signup trigger stored the pending application atomically. Without
      // a session the RLS-protected fallback insert cannot run — and is not
      // needed.
      setSuccess('faculty-pending');
      return;
    }

    // Fallback for deployments that predate the signup trigger.
    const { error: applicationError } = await supabase
      .from('faculty_applications')
      .insert(
        buildFacultyApplicationRow(userId, email.trim(), {
          name,
          department,
          designation,
          employeeId,
        })
      );

    const outcome = classifyFacultyApplicationInsert(applicationError);
    if (outcome === 'created' || outcome === 'already-pending') {
      setSuccess('faculty-pending');
      return;
    }

    if (applicationError) {
      logSupabaseError('Faculty application insert failed', applicationError);
    }

    if (outcome === 'profile-not-ready') {
      setError(
        'Account created but the application could not be saved (profile not yet ready). Please sign in and try submitting again in a moment.'
      );
      return;
    }

    setError(
      'Your account was created, but saving your application failed. Please sign in and try submitting again, or contact support.'
    );
  };

  const submit = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      if (role === 'student') await submitStudent();
      else if (role === 'alumni') await submitAlumni();
      else await submitFaculty();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign up failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const roleCopy =
    role === 'student'
      ? {
          title: 'Join the community',
          subtitle: 'Create your student profile for the CSE department.',
          action: 'Create student account',
        }
      : role === 'alumni'
        ? {
            title: 'Join as alumnus',
            subtitle: 'Create your alumni profile for the CSE department.',
            action: 'Create alumni account',
          }
        : {
            title: 'Faculty access request',
            subtitle: 'Apply for verified faculty permissions in the CSE community.',
            action: 'Submit application',
          };

  if (success) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={[styles.successContent, { paddingBottom: insets.bottom + 24 }]}
        >
          <View style={styles.successIcon}>
            <Ionicons
              name={success === 'faculty-pending' ? 'time-outline' : 'checkmark-circle-outline'}
              size={30}
              color={Brand.accent}
            />
          </View>
          <Text style={styles.successTitle}>
            {success === 'faculty-pending' ? 'Application submitted' : 'Check your email'}
          </Text>
          <Text style={styles.successCopy}>
            {success === 'faculty-pending'
              ? 'Your pending application has been saved for an administrator to review. Until approval, your account keeps standard student access.'
              : `We sent a verification link to ${email.trim()}. Confirm your address, then sign in to join the feed.`}
          </Text>
          <View style={styles.successActions}>
            <PrimaryButton
              label="Back to sign in"
              icon="arrow-back-outline"
              onPress={() => router.replace('/sign-in')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={KEYBOARD_AVOIDING_BEHAVIOR} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Math.max(20, insets.top + 8),
              paddingBottom: Math.max(28, insets.bottom + 20),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Wordmark size="large" />
            <Subtitle>UBDT CSE Community</Subtitle>
            <Text style={styles.heroTitle}>{roleCopy.title}</Text>
            <Text style={styles.heroCopy}>{roleCopy.subtitle}</Text>
          </View>

          <View style={styles.roleRow}>
            <FilterChips
              options={ROLE_OPTIONS}
              value={role}
              onChange={changeRole}
              accessibilityLabel="Choose account type"
            />
          </View>

          {role === 'faculty' ? (
            <View style={styles.notice}>
              <Ionicons name="time-outline" size={15} color={Brand.warning} />
              <Text style={styles.noticeText}>
                An administrator reviews every application before faculty permissions are granted.
                Until approved, your account keeps standard student access.
              </Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <TextField
              label="Full name"
              placeholder="e.g. Varun Kumar"
              value={name}
              onChangeText={setName}
              autoComplete="name"
              maxLength={80}
              editable={!submitting}
            />

            <TextField
              label={role === 'faculty' ? 'Institutional email' : 'Email address'}
              placeholder={role === 'faculty' ? 'name@ubdt.edu.in' : 'you@example.com'}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="email"
              editable={!submitting}
            />

            {role === 'student' ? (
              <>
                <TextField
                  label="USN"
                  placeholder="e.g. 4UB24CS045"
                  value={usn}
                  onChangeText={updateUsn}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  editable={!submitting}
                  hint={
                    usn && getYearFromUSN(usn)
                      ? `Detected as ${year}${year === 1 ? 'st' : year === 2 ? 'nd' : year === 3 ? 'rd' : 'th'} year`
                      : usn
                        ? '4UB[YY]CS[Roll] — academic year is detected automatically'
                        : 'No USN yet? First-year students can use an admission number below.'
                  }
                  error={
                    usn && !getYearFromUSN(usn)
                      ? 'Invalid USN. Expected format: 4UB24CS045'
                      : null
                  }
                />

                {year === 1 && !usn.trim() ? (
                  <TextField
                    label="Admission number"
                    placeholder="e.g. ADM-2026-001"
                    value={admissionNumber}
                    onChangeText={(value) => setAdmissionNumber(value.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={24}
                    editable={!submitting}
                    hint="For first-year students without a USN. 4-24 letters, digits, hyphens or slashes."
                  />
                ) : null}
              </>
            ) : null}

            {role === 'alumni' ? (
              <TextField
                label="Graduation year"
                placeholder={String(new Date().getFullYear())}
                value={graduationYear}
                onChangeText={setGraduationYear}
                keyboardType="number-pad"
                maxLength={4}
                editable={!submitting}
                hint="Between 1950 and the current year."
              />
            ) : null}

            {role === 'faculty' ? (
              <>
                <TextField
                  label="Department"
                  placeholder="CSE"
                  value={department}
                  onChangeText={setDepartment}
                  maxLength={80}
                  editable={!submitting}
                />
                <TextField
                  label="Designation"
                  placeholder="e.g. Assistant Professor"
                  value={designation}
                  onChangeText={setDesignation}
                  maxLength={120}
                  editable={!submitting}
                />
                <TextField
                  label="Employee ID (optional)"
                  placeholder="e.g. UBDT-CSE-014"
                  value={employeeId}
                  onChangeText={setEmployeeId}
                  autoCapitalize="characters"
                  maxLength={80}
                  editable={!submitting}
                />
              </>
            ) : (
              <>
                <TextField
                  label="Section (optional)"
                  placeholder="e.g. A"
                  value={section}
                  onChangeText={setSection}
                  maxLength={4}
                  autoCapitalize="characters"
                  editable={!submitting}
                />
                <TextField
                  label="Skills (optional)"
                  placeholder="React, Python, UI design"
                  value={skills}
                  onChangeText={setSkills}
                  hint="Comma-separated. You can edit these later."
                  editable={!submitting}
                />
              </>
            )}

            <TextField
              label="Password"
              secure
              hidden={passwordHidden}
              toggleHidden={() => setPasswordHidden((previous) => !previous)}
              placeholder="At least 6 characters"
              value={password}
              onChangeText={setPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!submitting}
            />
            <TextField
              label="Confirm password"
              secure
              hidden={confirmHidden}
              toggleHidden={() => setConfirmHidden((previous) => !previous)}
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!submitting}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />

            {confirmPassword && confirmPassword !== password ? (
              <Text style={styles.mismatch}>Passwords do not match.</Text>
            ) : null}

            {error ? <StatusBanner kind="error">{error}</StatusBanner> : null}

            <PrimaryButton
              label={roleCopy.action}
              icon="arrow-forward-outline"
              onPress={() => void submit()}
              busy={submitting}
              disabled={submitting}
            />
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={() => router.replace('/sign-in')}
              accessibilityRole="button"
              accessibilityLabel="Back to sign in"
              hitSlop={8}
              style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
            >
              <Ionicons name="arrow-back" size={14} color={Brand.accent} />
              <Text style={styles.backLinkText}>I already have an account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function friendlySignupError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('already registered')) {
    return 'This email is already registered. Please sign in instead.';
  }
  if (lower.includes('admission number')) {
    return 'This admission number is already registered. Sign in or contact the department.';
  }
  if (
    message.includes('duplicate key') ||
    message.includes('profiles_student_usn_unique') ||
    message.includes('profiles_usn_key')
  ) {
    return 'This USN is already registered. Please sign in or contact the administrator.';
  }
  return message || 'Sign up failed. Please try again.';
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Brand.canvas,
  },
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
  },
  hero: {
    marginBottom: 20,
  },
  heroTitle: {
    fontFamily: Type.displayBold,
    fontSize: 28,
    lineHeight: 34,
    color: Brand.chromeInk,
    marginTop: 22,
  },
  heroCopy: {
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Brand.muted,
    marginTop: 7,
  },
  roleRow: {
    marginHorizontal: -6,
    marginBottom: 16,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    marginBottom: 16,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.warning}55`,
    backgroundColor: 'rgba(240, 188, 105, 0.08)',
  },
  noticeText: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 17.5,
    color: Brand.muted,
  },
  form: {
    gap: 16,
  },
  mismatch: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.error,
    marginTop: -8,
  },
  footer: {
    marginTop: 20,
    alignItems: 'center',
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  backLinkText: {
    fontFamily: Type.bodyMedium,
    fontSize: 13,
    color: Brand.accent,
  },
  pressed: {
    opacity: 0.65,
  },
  successContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}66`,
    marginBottom: 18,
  },
  successTitle: {
    fontFamily: Type.displayBold,
    fontSize: 24,
    color: Brand.chromeInk,
    textAlign: 'center',
  },
  successCopy: {
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 21,
    color: Brand.muted,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 380,
  },
  successActions: {
    alignSelf: 'stretch',
    marginTop: 26,
  },
});
