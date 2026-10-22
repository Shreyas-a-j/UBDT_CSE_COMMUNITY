import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isApprovedFaculty } from '@/lib/profile'

const AUTH_ROUTES = ['/signin', '/signup', '/forgot-password', '/reset-password']
const PROTECTED_PREFIXES = ['/faculty/dashboard', '/admin']

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return supabaseResponse

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthRoute = AUTH_ROUTES.some(route => path === route || path.startsWith(`${route}/`))
  const isProtected = PROTECTED_PREFIXES.some(route => path === route || path.startsWith(`${route}/`))

  if (!user && isProtected) {
    const redirect = request.nextUrl.clone()
    redirect.pathname = '/signin'
    redirect.searchParams.set('next', path)
    return NextResponse.redirect(redirect)
  }

  if (user && isAuthRoute && path !== '/reset-password') {
    const redirect = request.nextUrl.clone()
    redirect.pathname = '/'
    return NextResponse.redirect(redirect)
  }

  if (user && (path === '/admin' || path.startsWith('/admin/'))) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'admin') {
      const redirect = request.nextUrl.clone()
      redirect.pathname = '/'
      return NextResponse.redirect(redirect)
    }
  }

  if (user && (path === '/faculty/dashboard' || path.startsWith('/faculty/dashboard/'))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, faculty_status')
      .eq('id', user.id)
      .maybeSingle()
    const allowed = isApprovedFaculty(profile)
    if (!allowed) {
      const redirect = request.nextUrl.clone()
      redirect.pathname = '/people'
      redirect.search = '?filter=faculty'
      return NextResponse.redirect(redirect)
    }
  }

  return supabaseResponse
}
