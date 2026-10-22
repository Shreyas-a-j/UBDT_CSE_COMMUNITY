# UBDT CSE Community - Implementation Plan

## Current Status Analysis

### ✅ Already Implemented
1. **Database Schema** - Complete with RLS, triggers, and functions
   - Profiles, Posts, Events, Comments, Likes, Upvotes, RSVPs
   - Connection requests, Conversations, Messages
   - Faculty applications, Announcements
   - Proper RLS policies and security functions

2. **Authentication Flow** - Student & Faculty signup/signin
   - Separate student and faculty registration
   - Faculty approval workflow (pending → verified)
   - Role-based access control (student, faculty, admin)
   - Auth context and profile management

3. **Basic Community Features**
   - Feed with posts (discussion & showcase)
   - Events with RSVPs
   - Comments, likes, upvotes
   - Notifications system
   - Basic profile display

4. **Types & Utilities**
   - Complete TypeScript types
   - Profile normalization
   - Validation utilities
   - Date/time formatting

### 🔧 Needs Fixing (Phase 1: Critical Bugs)
1. ~~Suspense boundaries for Next.js 16~~ ✅ FIXED
2. Build errors and TypeScript issues
3. Profile consistency (ensure single source of truth)
4. Missing components referenced but not created
5. Navbar crash protection

### 🚀 To Implement

#### Phase 2: Student Network & Connections (LinkedIn-style)
- [ ] `/connections` page - connection requests, accepted connections
- [ ] `/people` directory - search students by name, USN, skills, interests
- [ ] `/people/[id]` - individual profile view with connection status
- [ ] Connection logic hooks and API
- [ ] Connection button states (Connect, Pending, Connected)
- [ ] Connection recommendations

#### Phase 3: One-to-One Messaging
- [ ] `/messages` inbox page - conversation list
- [ ] `/messages/[id]` conversation view with real-time updates
- [ ] Message sending/receiving with Supabase Realtime
- [ ] Unread indicators and counts
- [ ] Message validation and sanitization
- [ ] Conversation participant restrictions (connected users only)

#### Phase 4: Faculty Portal
- [ ] `/faculty` landing page for faculty info
- [ ] `/faculty/dashboard` - faculty-only dashboard
- [ ] `/faculty/directory` - searchable faculty list
- [ ] `/faculty/announcements` - create/manage announcements
- [ ] Faculty profile cards with designation/expertise
- [ ] Academic events management (faculty can create)
- [ ] Verified faculty badge/indicator

#### Phase 5: Admin Panel
- [ ] `/admin` dashboard - overview stats
- [ ] `/admin/faculty-applications` - approve/reject faculty requests
- [ ] `/admin/users` - user management
- [ ] Admin-only actions and UI

#### Phase 6: Integration & Polish
- [ ] Integrate connections into feed (show connection status on profiles)
- [ ] Notifications for connections, messages, announcements
- [ ] Empty states for all features
- [ ] Loading states and error handling
- [ ] Responsive UI refinements
- [ ] Faculty announcements in community feed

## Implementation Order

### Phase 1: Fix Existing Issues ⚠️
1. Build and type errors
2. Profile data consistency
3. Navbar null-safety
4. Missing component stubs

### Phase 2: Student Connections 🔗
1. People directory with search
2. Profile detail pages
3. Connection request system
4. Connection management page

### Phase 3: Messaging 💬
1. Conversation list/inbox
2. Message thread view
3. Real-time message updates
4. Message notifications

### Phase 4: Faculty Features 👨‍🏫
1. Faculty directory
2. Faculty dashboard
3. Announcements system
4. Faculty event management

### Phase 5: Admin Panel ⚙️
1. Faculty approval workflow
2. User management
3. System stats

### Phase 6: Final Integration ✨
1. Connect all features
2. Notification improvements
3. UI polish
4. Testing and verification

## Database Migration Status

✅ Migration file exists: `supabase/migrations/2026101301_network_and_faculty.sql`
- Contains all tables, indexes, functions, triggers, and RLS policies
- Ready to apply to Supabase instance

**Manual Steps Required:**
1. Apply migration to Supabase (if not already applied)
2. Reload PostgREST schema: `NOTIFY pgrst, 'reload schema';`
3. Verify RLS policies are active
4. Create first admin user (manual SQL or env-based bootstrap)

## Environment Variables Required

```env
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

## Security Checklist

- [x] RLS enabled on all tables
- [x] Faculty role cannot be self-assigned
- [x] Connection requests enforce bidirectional uniqueness
- [x] Messages restricted to conversation participants
- [x] Announcements restricted to verified faculty
- [x] Profile role/status updates protected by trigger
- [x] Admin-only operations enforced in middleware
- [ ] First admin provisioning documented
