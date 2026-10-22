'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import PasswordField from '@/components/auth/PasswordField'
import { createClient } from '@/lib/supabase/client'
import { canonicalAuthHref } from '@/lib/auth'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const passwordsMismatch = Boolean(confirmPassword && confirmPassword !== password)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        const msg = updateError.message || ''
        if (msg.toLowerCase().includes('session')) {
          setError('This reset link has expired. Request a new one from the sign-in page.')
        } else {
          setError(msg || 'Could not update your password. Please try again.')
        }
        return
      }

      router.push('/')
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update your password. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthFormShell title="Choose a new password" subtitle="Set a new password for your account.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5 text-[12.5px] text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <PasswordField
          id="reset-password"
          label="New password"
          placeholder="At least 6 characters"
          value={password}
          onChange={v => {
            setPassword(v)
            setError('')
          }}
          show={showPassword}
          onToggle={() => setShowPassword(v => !v)}
        />

        <div>
          <PasswordField
            id="reset-confirm"
            label="Confirm new password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={v => {
              setConfirmPassword(v)
              setError('')
            }}
            show={showConfirm}
            onToggle={() => setShowConfirm(v => !v)}
          />
          {passwordsMismatch && (
            <p className="mt-1.5 text-[11px] text-danger">Passwords do not match</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || passwordsMismatch}
          className="btn btn-accent btn-lg btn-block mt-1"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Updating password…
            </>
          ) : (
            <>
              Update password <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <p className="mt-2 text-center text-[12px] text-muted">
          <Link
            href={canonicalAuthHref()}
            className="font-medium text-ink underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthFormShell>
  )
}
