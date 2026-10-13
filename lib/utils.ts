import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Validate USN format: 4UB[year <= current]CS[any <= 999] (e.g. 4UB24CS045)
export function validateUSN(usn: string): boolean {
  const match = usn.trim().match(/^4UB(\d{2})CS(\d{1,3})$/i)
  if (!match) return false
  const admissionYearTwoDigits = parseInt(match[1], 10)
  const roll = parseInt(match[2], 10)

  let currentYearTwoDigits = 26
  try {
    currentYearTwoDigits = new Date().getFullYear() % 100
  } catch {}

  // year <= current
  if (admissionYearTwoDigits > currentYearTwoDigits) return false

  // any <= 999
  if (roll < 1 || roll > 999) return false

  return true
}

// Derive year from USN admission year
export function getYearFromUSN(usn: string): number | null {
  const match = usn.trim().match(/^4UB(\d{2})CS(\d{1,3})$/i)
  if (!match) return null

  const admissionYearTwoDigits = parseInt(match[1], 10)
  const roll = parseInt(match[2], 10)

  let currentYear = 2026
  try {
    currentYear = new Date().getFullYear()
  } catch {}

  const currentYearTwoDigits = currentYear % 100
  if (admissionYearTwoDigits > currentYearTwoDigits) return null
  if (roll < 1 || roll > 999) return null

  const admissionFullYear = 2000 + admissionYearTwoDigits
  const diff = currentYear - admissionFullYear + 1

  if (diff >= 1 && diff <= 4) return diff
  if (diff > 4) return 4
  return 1
}

export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy')
  } catch {
    return dateStr
  }
}

export function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true })
  } catch {
    return dateStr
  }
}

export function formatEventDateTime(date: string, time: string): string {
  try {
    const dt = parseISO(`${date}T${time}`)
    return format(dt, "EEE, MMM d 'at' h:mm a")
  } catch {
    return `${date} at ${time}`
  }
}

export function getCountdown(date: string, time: string): string {
  if (typeof window === 'undefined') return ''
  try {
    const eventDt = parseISO(`${date}T${time}`)
    const now = new Date()
    const diff = eventDt.getTime() - now.getTime()
    if (diff < 0) return 'Event ended'
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  } catch {
    return ''
  }
}

export function getYearLabel(year?: number | null): string {
  if (!year) return 'CSE'
  const labels: Record<number, string> = {
    1: '1st Year',
    2: '2nd Year',
    3: '3rd Year',
    4: '4th Year',
  }
  return labels[year] || `Year ${year}`
}

export function getEventTypeColor(type: string): string {
  const colors: Record<string, string> = {
    Workshop: 'bg-indigo-100 text-indigo-700',
    Meeting: 'bg-emerald-100 text-emerald-700',
    Showcase: 'bg-amber-100 text-amber-800',
  }
  return colors[type] || 'bg-gray-100 text-gray-700'
}

export function getAvatarFallback(name?: string | null): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return '?'
  return trimmed
    .split(/\s+/)
    .map(n => n[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'
}

export function getSupabaseImageUrl(bucket: string, path: string, supabaseUrl: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`
}
