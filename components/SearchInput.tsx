'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'

export default function SearchInput({
  className = '',
  inputClassName = '',
  autoFocus = false,
  onSearch,
}: {
  className?: string
  inputClassName?: string
  autoFocus?: boolean
  onSearch?: () => void
}) {
  const { searchQuery, setSearchQuery } = useCommunity()
  const pathname = usePathname()
  const router = useRouter()

  const handleChange = (value: string) => {
    setSearchQuery(value)
    if (pathname !== '/') router.push('/')
  }

  return (
    <div className={`relative ${className}`}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim"
        aria-hidden
      />
      <input
        type="search"
        value={searchQuery}
        onChange={event => handleChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSearch?.()
          }
        }}
        placeholder="Search community"
        aria-label="Search the community"
        autoFocus={autoFocus}
        className={`field header-field w-full pl-9 pr-9 ${inputClassName}`}
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => setSearchQuery('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-header-muted transition-colors hover:bg-white/10 hover:text-header-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
