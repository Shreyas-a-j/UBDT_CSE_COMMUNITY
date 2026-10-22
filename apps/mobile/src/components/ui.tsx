/**
 * Small UCC-styled UI primitives: text fields, buttons, chips, banners, cards.
 * Discipline rules: hairline separators, one violet accent reserved for
 * interaction, Space Grotesk for headings, Inter for everything else.
 */

import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Brand, Radius, Type } from '@/lib/theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/* ---------------------------------- Card ---------------------------------- */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/* -------------------------------- TextField ------------------------------- */

interface TextFieldProps extends TextInputProps {
  label: string;
  secure?: boolean;
  hidden?: boolean;
  toggleHidden?: () => void;
  hint?: string;
  error?: string | null;
}

export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(
  { label, secure, hidden = secure ?? false, toggleHidden, hint, error, multiline, ...props },
  ref
) {
  const obscured = secure ? hidden : false;
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.fieldRow, multiline && styles.fieldRowMultiline, error ? styles.fieldRowError : null]}>
        <TextInput
          ref={ref}
          style={[styles.field, multiline && styles.fieldMultiline, secure && !multiline && styles.fieldSecure]}
          placeholderTextColor={Brand.dim}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={obscured}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          selectionColor={Brand.accent}
          underlineColorAndroid="transparent"
          {...props}
        />
        {secure && toggleHidden && !multiline ? (
          <Pressable
            onPress={toggleHidden}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={styles.revealHit}
          >
            <Text style={styles.reveal}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
});

/* --------------------------------- Buttons -------------------------------- */

interface ButtonProps {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  accessibilityLabel?: string;
}

export function PrimaryButton({ label, onPress, busy, disabled, icon, accessibilityLabel }: ButtonProps) {
  const deEmphasised = Boolean(busy) || Boolean(disabled);
  return (
    <Pressable
      onPress={onPress}
      disabled={deEmphasised}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: Boolean(busy), disabled: deEmphasised }}
      style={({ pressed }) => [styles.primaryBtn, (deEmphasised || pressed) && styles.primaryBtnPressed]}
    >
      {busy ? (
        <ActivityIndicator color={Brand.accentInk} size="small" />
      ) : (
        <View style={styles.btnContent}>
          {icon ? <Ionicons name={icon} size={17} color={Brand.accentInk} /> : null}
          <Text style={styles.primaryBtnLabel}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function GhostButton({ label, onPress, disabled, icon, accessibilityLabel }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [styles.ghostBtn, disabled && styles.disabled, pressed && styles.pressedSurface]}
    >
      <View style={styles.btnContent}>
        {icon ? <Ionicons name={icon} size={16} color={Brand.ink} /> : null}
        <Text style={[styles.ghostBtnLabel, disabled && styles.disabledLabel]}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** Compact action used inside cards (44pt minimum height). */
export function ActionButton({
  label,
  onPress,
  icon,
  tone = 'plain',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  tone?: 'plain' | 'accent' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const color = tone === 'accent' ? Brand.accent : tone === 'danger' ? Brand.error : Brand.muted;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.actionBtn,
        tone === 'accent' && styles.actionBtnAccent,
        (pressed || disabled) && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={15} color={color} /> : null}
          <Text style={[styles.actionLabel, { color }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'plain',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'plain' | 'accent' | 'danger';
}) {
  const color = tone === 'accent' ? Brand.accent : tone === 'danger' ? Brand.error : Brand.muted;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.pressedSurface]}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

/* ---------------------------------- Chip ---------------------------------- */

export function Chip({ text, tone = 'plain' }: { text: string; tone?: 'plain' | 'accent' | 'warn' }) {
  const color = tone === 'accent' ? Brand.accent : tone === 'warn' ? Brand.warning : Brand.muted;
  return (
    <View style={[styles.chip, tone !== 'plain' && { borderColor: `${color}66`, backgroundColor: `${color}12` }]}>
      <Text style={[styles.chipLabel, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function ChipRow({ values, tone }: { values: string[]; tone?: 'plain' | 'accent' | 'warn' }) {
  if (values.length === 0) return null;
  return (
    <View style={styles.chipRow}>
      {values.map((value) => (
        <Chip key={value} text={value} tone={tone} />
      ))}
    </View>
  );
}

/* ------------------------------ Status banner ----------------------------- */

export type BannerKind = 'error' | 'warning' | 'info' | 'success';

export function StatusBanner({ kind, children }: { kind: BannerKind; children: ReactNode }) {
  const map: Record<BannerKind, { color: string; bg: string; label: string; icon: IconName }> = {
    error: { color: Brand.error, bg: 'rgba(240, 120, 120, 0.10)', label: 'Error: ', icon: 'alert-circle-outline' },
    warning: {
      color: Brand.warning,
      bg: 'rgba(240, 188, 105, 0.10)',
      label: 'Notice: ',
      icon: 'alert-outline',
    },
    info: { color: Brand.accent, bg: Brand.accentSoft, label: '', icon: 'information-circle-outline' },
    success: { color: Brand.success, bg: 'rgba(66, 201, 151, 0.10)', label: '', icon: 'checkmark-circle-outline' },
  };
  const tone = map[kind];
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.banner, { borderColor: `${tone.color}66`, backgroundColor: tone.bg }]}
    >
      <Ionicons name={tone.icon} size={17} color={tone.color} style={styles.bannerIcon} />
      <Text style={[styles.bannerText, { color: tone.color }]}>
        {tone.label}
        {children}
      </Text>
    </View>
  );
}

/* ------------------------------ Section label ----------------------------- */

export function SectionLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {trailing}
    </View>
  );
}

/* --------------------------- Scrollable screen ---------------------------- */

export function ScrollPane({
  children,
  contentContainerStyle,
  ...props
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  keyboardDismissMode?: 'none' | 'on-drag' | 'interactive';
  showsVerticalScrollIndicator?: boolean;
}) {
  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...props}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 18,
  },
  fieldLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
    color: Brand.muted,
    marginBottom: 7,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.elevated,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: 13,
    minHeight: 48,
  },
  fieldRowMultiline: {
    alignItems: 'stretch',
    minHeight: 120,
    paddingVertical: 4,
  },
  fieldRowError: {
    borderColor: Brand.error,
  },
  field: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 15,
    lineHeight: 21,
    color: Brand.ink,
    paddingVertical: 12,
    minHeight: 46,
  },
  fieldMultiline: {
    minHeight: 112,
    paddingTop: 10,
  },
  fieldSecure: {
    paddingRight: 44,
  },
  revealHit: {
    minWidth: 48,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  reveal: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
    color: Brand.accent,
    paddingHorizontal: 4,
  },
  fieldHint: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    marginTop: 6,
    lineHeight: 16,
  },
  fieldError: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.error,
    marginTop: 6,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  primaryBtn: {
    backgroundColor: Brand.accent,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryBtnPressed: {
    backgroundColor: Brand.accentHover,
    opacity: 0.92,
  },
  primaryBtnLabel: {
    fontFamily: Type.bodySemiBold,
    fontSize: 15,
    color: Brand.accentInk,
  },
  ghostBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
    backgroundColor: Brand.elevated,
  },
  ghostBtnLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 14,
    color: Brand.ink,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
    backgroundColor: Brand.elevated,
  },
  actionBtnAccent: {
    borderColor: `${Brand.accent}88`,
    backgroundColor: Brand.accentSoft,
  },
  actionLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
  disabledLabel: {
    color: Brand.dim,
  },
  pressedSurface: {
    backgroundColor: Brand.pressed,
  },
  chip: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.lineStrong,
    backgroundColor: Brand.elevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  chipLabel: {
    fontFamily: Type.body,
    fontSize: 12,
    color: Brand.muted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  bannerIcon: {
    marginTop: 1,
  },
  bannerText: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 19,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionLabel: {
    fontFamily: Type.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 36,
  },
});
