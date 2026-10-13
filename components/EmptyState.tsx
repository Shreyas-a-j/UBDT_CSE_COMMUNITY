'use client'

export default function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '40px 20px', textAlign: 'center', boxShadow: '4px 4px 0px #000' }}>
      {icon && <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>{icon}</div>}
      <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#e8f4fd', marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: '0.825rem', color: '#6bafd4', marginBottom: action ? 20 : 0, lineHeight: 1.6 }}>{body}</p>
      {action}
    </div>
  )
}
