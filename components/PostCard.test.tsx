/**
 * PostCard delete-control regression tests (Bug 2)
 *
 * Ownership gating must follow the DB author identity (and admin role,
 * matching the RLS policy), not the fragile USN comparison, so:
 *   - the author sees edit/delete controls and confirms before deletion
 *   - duplicate submissions are disabled while deletion is in flight
 *   - another user never sees the delete control (authorization lives
 *     server-side via RLS; the button is only UI affordance)
 *   - an admin sees the control, mirroring the is_admin() delete policy
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PostCard from './PostCard'
import { Post, Profile } from '@/lib/types'

const useRouterMock = vi.hoisted(() => ({ push: vi.fn() }))
const useCommunityMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => useRouterMock,
}))
vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: (props?: unknown) => useCommunityMock(props),
}))

const viewerProfile = { id: 'user-2', usn: '4UB24CS999', role: 'student' } as unknown as Profile

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-9',
    author_id: 'user-3',
    type: 'discussion',
    title: 'How to get started with Rust?',
    body: 'Sharing resources.',
    image_url: null,
    github_url: null,
    demo_url: null,
    tech_stack: [],
    tags: ['General'],
    target_years: [1, 2, 3, 4],
    created_at: '2026-10-19T10:00:00.000Z',
    author_name: 'Bob Author',
    author_usn: '4UB24CS003',
    author_avatar: null,
    ...overrides,
  }
}

function makeContext(currentUser: Profile | null, deletePost: ReturnType<typeof vi.fn>) {
  return {
    currentUser,
    likedPostIds: new Set<string>(),
    upvotedPostIds: new Set<string>(),
    comments: [],
    addComment: vi.fn(),
    updatePost: vi.fn(),
    deletePost,
  }
}

beforeEach(() => {
  useRouterMock.push.mockReset()
  vi.spyOn(window, 'confirm').mockImplementation(() => true)
})

describe('PostCard delete controls', () => {
  it('the author sees the delete control and calls deletePost after confirming', async () => {
    const deletePost = vi.fn().mockResolvedValue(true)
    useCommunityMock.mockReturnValue(makeContext(
      { id: 'user-3', usn: '4UB24CS003', role: 'student' } as unknown as Profile,
      deletePost
    ))

    render(<PostCard post={makePost()} />)

    const button = screen.getByRole('button', { name: 'Delete post' })
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Delete this discussion/i))
    await waitFor(() => expect(deletePost).toHaveBeenCalledTimes(1))
    expect(deletePost).toHaveBeenCalledWith('post-9')
  })

  it('does not delete when the confirmation is declined', async () => {
    const deletePost = vi.fn().mockResolvedValue(true)
    useCommunityMock.mockReturnValue(makeContext(
      { id: 'user-3', usn: '4UB24CS003', role: 'student' } as unknown as Profile,
      deletePost
    ))
    ;(window.confirm as ReturnType<typeof vi.spyOn>).mockImplementation(() => false)

    render(<PostCard post={makePost()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }))

    expect(deletePost).not.toHaveBeenCalled()
  })

  it('disables the delete control while a deletion is already in flight', async () => {
    let resolveDeletion!: () => void
    const gate = new Promise<void>(resolve => { resolveDeletion = resolve })
    const deletePost = vi.fn().mockReturnValue(gate.then(() => true as const))
    useCommunityMock.mockReturnValue(makeContext(
      { id: 'user-3', usn: '4UB24CS003', role: 'student' } as unknown as Profile,
      deletePost
    ))

    render(<PostCard post={makePost()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete post' })).toBeDisabled()
    })
    // Confirm + a second interactive click does not double-fire the mutation.
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }))
    resolveDeletion()
    await waitFor(() => expect(deletePost).toHaveBeenCalledTimes(1))
  })

  it('hides delete and edit controls from other users entirely', () => {
    const deletePost = vi.fn().mockResolvedValue(true)
    useCommunityMock.mockReturnValue(makeContext(viewerProfile, deletePost))

    render(<PostCard post={makePost()} />)

    expect(screen.queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit post' })).not.toBeInTheDocument()
  })

  it('shows the delete control to admins, matching the is_admin() RLS allowance', () => {
    const deletePost = vi.fn().mockResolvedValue(true)
    useCommunityMock.mockReturnValue(makeContext(
      { id: 'user-admin', usn: null, role: 'admin' } as unknown as Profile,
      deletePost
    ))

    render(<PostCard post={makePost()} />)

    expect(screen.getByRole('button', { name: 'Delete post' })).toBeEnabled()
  })

  it('does not grant controls via coincidental USN identity mismatches', () => {
    // Viewer shares the author's USN string shape but is NOT the author.
    const deletePost = vi.fn().mockResolvedValue(true)
    useCommunityMock.mockReturnValue(makeContext(viewerProfile, deletePost))

    render(<PostCard post={makePost({ author_usn: '4UB24CS999' })} />)

    // Old logic (usn comparison) would have shown the delete button here even
    // though this user cannot delete the record; identity must come from IDs.
    expect(screen.queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument()
  })
})
