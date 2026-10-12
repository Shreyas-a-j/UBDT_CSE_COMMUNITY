import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Validate USN format: 1UBxxCS### (e.g. 1UB21CS001)
export function validateUSN(usn: string): boolean {
  const pattern = /^1UB\d{2}CS\d{3}$/i
  return pattern.test(usn)
}

// Derive year from USN admission year
// Convention: 1UB21CS001 → admitted 2021 → current year depends on current calendar year
// We return 1-4 based on how many years ago they were admitted (relative to 2024-25 academic year)
export function getYearFromUSN(usn: string): number | null {
  const match = usn.match(/^1UB(\d{2})CS\d{3}$/i)
  if (!match) return null
  const batch = match[1]
  if (batch === '21') return 4
  if (batch === '22') return 3
  if (batch === '23') return 2
  if (batch === '24') return 1
  const admissionYear = parseInt('20' + batch, 10)
  const year = 2024 - admissionYear + 1
  if (year >= 1 && year <= 4) return year
  return null
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

export function getYearLabel(year: number): string {
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

export function getAvatarFallback(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function getSupabaseImageUrl(bucket: string, path: string, supabaseUrl: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`
}
