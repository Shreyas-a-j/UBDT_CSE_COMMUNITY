export default function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite" aria-label="Loading content">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton flex items-start gap-3.5 p-5">
          <div className="h-10 w-10 shrink-0 rounded-full bg-elevated" />
          <div className="flex-1 space-y-3 py-0.5">
            <div className="h-3 w-1/3 rounded bg-line" />
            <div className="h-3 w-4/5 rounded bg-line/70" />
            <div className="h-3 w-2/5 rounded bg-line/50" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}
