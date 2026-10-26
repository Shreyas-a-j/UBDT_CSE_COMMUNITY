/**
 * Expo SDK 58 enables edge-to-edge on Android, which makes `adjustResize`
 * behave like `adjustNothing`: the window no longer shrinks when the keyboard
 * opens. Applying `padding` in JavaScript keeps focused fields and the submit
 * controls above the keyboard on both platforms. `undefined` renders a plain
 * View on Android, leaving inputs covered.
 */
export const KEYBOARD_AVOIDING_BEHAVIOR = 'padding' as const;
