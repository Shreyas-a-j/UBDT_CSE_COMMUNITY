export default function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            background: '#0d1426',
            border: '2px solid #1e3560',
            height: 88,
            boxShadow: '4px 4px 0px #000',
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  )
}
