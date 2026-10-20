/**
 * New post modal regression tests (Bug 1)
 *
 * Simulates the end-to-end acceptance flow: open the modal, type a multiword
 * title / long details / comma-separated tags without the input losing focus
 * or being remounted, switch post types, hit validation states, submit and
 * verify the reopened modal starts from the initial form state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import CreatePostModal from './CreatePostModal'

const useCommunityMock = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: (props?: unknown) => useCommunityMock(props),
}))

// jsdom lacks requestAnimationFrame; Modal's initial-focus pass needs it.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0)
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

function flushTurns(ms = 30) {
  return act(() => new Promise(resolve => setTimeout(resolve, ms)))
}

function makeContext(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isCreatePostOpen: true,
    setIsCreatePostOpen: vi.fn(),
    createPost: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

let context: ReturnType<typeof makeContext>

beforeEach(() => {
  context = makeContext()
  useCommunityMock.mockReturnValue(context)
  return () => {
    vi.unstubAllGlobals()
  }
})
/**
 * Type into a real controlled input character stream — one driver-driven
 * change per character — and assert after every update that focus is still
 * inside the SAME DOM node (i.e. it was not replaced or blurred).
 */
async function typeContinuously(input: HTMLElement, text: string) {
  input.focus()
  let value = ''
  for (const char of text) {
    value += char
    fireEvent.change(input, { target: { value } })
    await flushTurns()
    expect(document.activeElement).toBe(input)
  }
  return value
}

describe('CreatePostModal', () => {
  it('keeps focus on the title input across every keystroke', async () => {
    render(<CreatePostModal />)
    await flushTurns() // settle the one-time initial focus pass

    const title = screen.getByLabelText('Title')
    title.focus()
    await typeContinuously(title, 'Placement prep')

    expect(document.activeElement).toBe(title)
    expect((title as HTMLInputElement).value).toBe('Placement prep')
  })

  it('keeps focus on the Details textarea while typing several sentences', async () => {
    render(<CreatePostModal />)
    await flushTurns()

    const details = screen.getByLabelText('Details')
    details.focus()
    await typeContinuously(
      details,
      'How should we prepare? Review DSA basics. Mock interviews help a lot.'
    )

    expect(document.activeElement).toBe(details)
    expect((details as HTMLTextAreaElement).value).toContain('Mock interviews help a lot.')
  })

  it('keeps focus on the tags input while entering comma separated tags', async () => {
    render(<CreatePostModal />)
    await flushTurns()

    const tags = screen.getByLabelText('Tags, comma separated')
    tags.focus()
    await typeContinuously(tags, 'DSA, Placements, WebDev')

    expect(document.activeElement).toBe(tags)
    expect((tags as HTMLInputElement).value).toBe('DSA, Placements, WebDev')
  })

  it('switches to the showcase form and keeps new inputs typeable', async () => {
    render(<CreatePostModal />)
    await flushTurns()

    fireEvent.click(screen.getByRole('tab', { name: /Project showcase/i }))
    await flushTurns()

    const github = screen.getByLabelText(/GitHub repository/i)
    github.focus()
    await typeContinuously(github, 'https://github.com/org/repo')
    expect(document.activeElement).toBe(github)

    fireEvent.click(screen.getByRole('tab', { name: /^Discussion$/i }))
    await flushTurns()
    // Back on the discussion form, continuous typing still works.
    const title = screen.getByLabelText('Title')
    title.focus()
    await typeContinuously(title, 'Back on discussion')
    expect((title as HTMLInputElement).value).toBe('Back on discussion')
  })

  it('keeps focus while validation blocks submit and the user keeps editing', async () => {
    render(<CreatePostModal />)
    await flushTurns()

    // Empty title/body → submit disabled.
    const publish = screen.getByRole('button', { name: /Publish post/i })
    expect(publish).toBeDisabled()

    const title = screen.getByLabelText('Title')
    title.focus()
    await typeContinuously(title, 'Blocked but focused')
    expect(publish).toBeDisabled() // body still empty
    expect(document.activeElement).toBe(title)
  })

  it('submits the composed post with parsed tags and closes the modal', async () => {
    render(<CreatePostModal />)
    await flushTurns()

    const title = screen.getByLabelText('Title')
    title.focus()
    await typeContinuously(title, 'Study group for DBMS')
    await typeContinuously(screen.getByLabelText('Details'), 'Normalisation questions for internals.')
    await typeContinuously(screen.getByLabelText('Tags, comma separated'), 'DBMS, Exams')
    await flushTurns()

    fireEvent.click(screen.getByRole('button', { name: /Publish post/i }))

    await waitFor(() => expect(context.createPost).toHaveBeenCalledTimes(1))
    const payload = context.createPost.mock.calls[0][0]
    expect(payload.type).toBe('discussion')
    expect(payload.title).toBe('Study group for DBMS')
    expect(payload.tags).toEqual(['DBMS', 'Exams'])
    await waitFor(() => expect(context.setIsCreatePostOpen).toHaveBeenCalledWith(false))
  })

  it('returns the form to its initial state after close and reopen', async () => {
    const { rerender } = render(<CreatePostModal />)
    await flushTurns()

    const title = screen.getByLabelText('Title')
    title.focus()
    await typeContinuously(title, 'Draft that will be abandoned')

    // Close the modal via the real user path — the Cancel button, which
    // funnels through the same close handler as Escape / the X / overlay.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(context.setIsCreatePostOpen).toHaveBeenCalledWith(false)

    // ...and reopen it.
    context = makeContext()
    useCommunityMock.mockReturnValue(context)
    rerender(<CreatePostModal />)
    await flushTurns()

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('tab', { name: /^Discussion$/i })).toHaveAttribute('aria-selected', 'true')
  })
})
