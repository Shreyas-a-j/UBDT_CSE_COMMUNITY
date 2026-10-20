/**
 * Modal focus regression tests (Bug 1)
 *
 * The bug: Modal's focus-management effect depended on `onClose`. Consumers
 * pass inline closures recreated on every render, so every keystroke
 * re-ran the effect and re-focused the panel — stealing focus from the
 * input after a single character.
 *
 * These tests simulate the exact consumer pattern used by
 * CreatePostModal / CreateEventModal / AuthModal / ProfileModal: a parent
 * whose state change re-renders it, recreating onClose each render.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React, { useState } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import Modal from './Modal'

// jsdom does not implement requestAnimationFrame without pretendToBeVisual;
// the Modal uses it for its initial focus pass, so stand it up with a timer.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0)
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  return () => {
    vi.unstubAllGlobals()
  }
})

/**
 * Same shape as the app's modal forms: every keystroke re-renders the
 * parent, which recreates the inline onClose closure. Controlled inputs.
 */
function ControlledFieldModal() {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState('')
  return (
    <Modal open={open} onClose={() => setOpen(false)} labelledBy="modal-title">
      <h2 id="modal-title">Dialog</h2>
      <label htmlFor="field">Field</label>
      <input
        id="field"
        data-testid="field"
        value={value}
        onChange={e => setValue(e.target.value)}
      />
    </Modal>
  )
}

/** Flush pending rAF callbacks so the initial-focus pass has settled. */
function flushTurns(ms = 30) {
  return act(() => new Promise(resolve => setTimeout(resolve, ms)))
}

describe('Modal', () => {
  it('focuses the panel once when opened', async () => {
    render(<ControlledFieldModal />)
    await flushTurns()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('keeps focus and the same input DOM node while the parent re-renders on typing', async () => {
    const { getByTestId } = render(<ControlledFieldModal />)
    await flushTurns()

    const field = getByTestId('field')
    field.focus()
    expect(document.activeElement).toBe(field)

    // Type several characters, one state update per character. After each
    // update the parent re-renders and passes a brand-new onClose closure.
    for (const char of ['a', 'b', ' ', 'c']) {
      fireEvent.change(getByTestId('field'), { target: { value: char.repeat(2) } })
      await flushTurns()
      const node = getByTestId('field')
      // The input was not remounted (same DOM node)...
      expect(node).toBe(field)
      // ...and focus was not stolen back by the panel.
      expect(document.activeElement).toBe(node)
      expect((node as HTMLInputElement).value).toContain(char)
    }
  })

  it('closes on Escape using the latest onClose closure', async () => {
    const { getByTestId } = render(<ControlledFieldModal />)
    await flushTurns()
    const field = getByTestId('field') as HTMLInputElement
    field.focus()
    fireEvent.change(field, { target: { value: 'typed' } })
    await flushTurns()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
