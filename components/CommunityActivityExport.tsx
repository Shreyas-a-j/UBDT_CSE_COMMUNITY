'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { sixMonthWindow, type SixMonthWindow } from '@/lib/csv'

/**
 * Download control for the six-month community activity CSV.
 *
 * The button is only a convenience: `/api/export/community-activity` performs
 * the real authorization check on the server from the caller's database
 * profile, so hiding or showing this component never grants access.
 *
 * The displayed date range is recomputed in the browser as well. The server
 * recalculates it from a single clock reading on each download, so the CSV
 * manifest and the database query always refer to the same instant.
 */
export default function CommunityActivityExport() {
  const [exporting, setExporting] = useState(false)
  // Start as null so server-rendered and client-rendered markup match; the
  // window is filled in after mount and refreshed so a tab left open
  // overnight does not display yesterday's range.
  const [range, setRange] = useState<SixMonthWindow | null>(null)

  useEffect(() => {
    const update = () => setRange(sixMonthWindow(new Date()))
    update()
    const timer = window.setInterval(update, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const handleDownloadCsv = async () => {
    setExporting(true)
    try {
      const response = await fetch('/api/export/community-activity', {
        method: 'GET',
        headers: { Accept: 'text/csv' },
      })

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as
          | { error?: string }
          | undefined
        toast.error(error?.error || 'The export could not be completed.')
        return
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download =
        response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'ucc-community-activity.csv'
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      // Revoke on the next task: some browsers abort the download if the
      // object URL is released synchronously after the click.
      setTimeout(() => URL.revokeObjectURL(url), 0)

      toast.success('Community activity CSV downloaded')
    } catch {
      toast.error('The export could not be completed. Check your connection and try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line bg-surface px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <Download className="h-4 w-4" /> Community activity export
          </h2>
          <p className="mt-1 text-[12px] text-muted">
            Download events, project showcases, and announcements from the
            trailing six calendar months. Available to approved faculty.
          </p>
          <p className="mt-1 font-mono text-[10.5px] text-dim">
            Window:{' '}
            <span className="text-muted">
              {range ? `${range.startDate} to ${range.endDate}` : 'calculated at download time'}
            </span>{' '}
            (UTC, inclusive)
          </p>
          <p className="mt-0.5 text-[10.5px] text-dim">
            The CSV includes start_date, end_date, exported_at and the included
            record types as manifest rows.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadCsv}
          disabled={exporting}
          className="btn btn-accent btn-sm shrink-0"
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Download CSV
        </button>
      </div>
    </section>
  )
}
