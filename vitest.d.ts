/**
 * Type augmentation for @testing-library/react's RenderHookResult.
 *
 * The installed version of @testing-library/react does not expose
 * `waitForNextUpdate` on the RenderHookResult type, but the runtime
 * provides it. This declaration fills the type gap so existing tests
 * that destructure it (`const { waitForNextUpdate } = renderHook(...)`)
 * type-check under `strict: true`.
 */
import 'vitest'

declare module '@testing-library/react' {
  interface RenderHookResult<T, Q> {
    waitForNextUpdate(): Promise<void>
  }
}