/**
 * UCC brand tokens — ported from the web app's `app/globals.css` @theme block
 * so the native app stays visually continuous with the website.
 *
 * The web defaults to a dark canvas (`color-scheme: dark`), so mobile is
 * dark-first: navy chrome, charcoal canvas, hairline surfaces, and a single
 * violet accent reserved strictly for interaction.
 */

export const Brand = {
  // Application chrome (web: --color-header / --color-sidebar)
  chrome: '#11111F',
  chromeLine: '#2A2B3A',
  chromeInk: '#F5F5F7',
  chromeMuted: '#B4B6C2',

  // Content surfaces (web dark palette)
  canvas: '#202124',
  surface: '#25272B',
  elevated: '#2C2F35',
  pressed: '#343743',
  tabBar: '#15161F',
  scrim: 'rgba(8, 9, 15, 0.72)',

  // Hairlines (web: --color-line / --color-line-strong)
  line: '#3A3D45',
  lineStrong: '#4A4E59',

  // Type
  ink: '#F5F5F7',
  muted: '#B4B6C2',
  dim: '#858998',

  // Single accent, reserved for interaction (web: --color-accent dark)
  accent: '#8B7CF6',
  accentHover: '#A99BFF',
  accentSoft: 'rgba(139, 124, 246, 0.12)',
  accentInk: '#14151F',

  // Semantic status colours (web: --color-success / warning / error)
  success: '#42C997',
  warning: '#F0BC69',
  error: '#F07878',
} as const;

/** Type families matching the web identity: Space Grotesk display / Inter body. */
export const Type = {
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
} as const;

/** Corner radii mirroring the web scale (6–14px). */
export const Radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  pill: 999,
} as const;
