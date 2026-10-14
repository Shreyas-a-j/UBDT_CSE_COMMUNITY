# UBDT CSE Community - README

## 🎓 Overview

UBDT CSE Community is a comprehensive student networking platform for the Computer Science & Engineering department, featuring LinkedIn-style connections, private messaging, faculty portal, and administrative controls.

**Live URL:** [https://ubdt-cse-community.vercel.app/](https://ubdt-cse-community.vercel.app/)

---

## ✨ Features

### 👥 Student Networking
- **Student Directory** - Search students by name, USN, skills, or interests
- **Profile Pages** - Detailed student profiles with bio, skills, and academic info
- **Connection System** - Send, accept, reject connection requests (LinkedIn-style)
- **Connection Management** - View connections, pending requests (sent/received)

### 💬 One-to-One Messaging
- **Private Messaging** - Secure conversations between connected students
- **Real-time Updates** - Messages appear instantly using Supabase Realtime
- **Unread Indicators** - Track unread messages and conversations
- **Message History** - Persistent message storage in database

### 👨‍🏫 Faculty Portal
- **Faculty Directory** - Public listing of verified faculty members
- **Faculty Dashboard** - Manage announcements and events
- **Announcements** - Faculty can publish announcements to all students
- **Academic Events** - Create and manage workshops, seminars, sessions

### ⚙️ Admin Panel
- **Faculty Approval** - Review and approve faculty applications
- **User Management** - View and manage user roles
- **Analytics** - Track pending, approved, and rejected applications

### 🔐 Security
- **Row Level Security** - Database-level access control
- **Role-Based Access** - Student, Faculty, Admin roles
- **Protected Routes** - Middleware enforces authentication
- **Secure Messaging** - Only connected users can message each other

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Supabase account
- Vercel account (for deployment)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/Shreyas-a-j/UBDT_CSE_COMMUNITY.git
   cd UBDT_CSE_COMMUNITY
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

4. **Apply database migration**
   - Go to Supabase SQL Editor
   - Run `supabase/migrations/20261013_network_and_faculty.sql`
   - Run `NOTIFY pgrst, 'reload schema';`

5. **Run development server**
   ```bash
   npm run dev
   ```
   
   Open [http://localhost:3000](http://localhost:3000)

---

## 📁 Project Structure

```
.
├── app/                          # Next.js App Router pages
│   ├── admin/                    # Admin dashboard
│   ├── connections/              # Connection management
│   ├── faculty/                  # Faculty portal
│   │   ├── dashboard/            # Faculty dashboard
│   │   └── announcements/        # Create announcements
│   ├── messages/                 # Messaging inbox
│   │   └── [id]/                 # Message thread
│   ├── people/                   # Student directory
│   │   └── [id]/                 # Profile detail
│   ├── signin/                   # Sign in
│   └── signup/                   # Sign up
│       └── faculty/              # Faculty signup
├── components/                   # Reusable components
├── contexts/                     # React contexts
│   ├── AuthContext.tsx           # Authentication state
│   └── CommunityContext.tsx      # Community data
├── hooks/                        # Custom hooks
│   ├── useConnections.ts         # Connection logic
│   └── useMessages.ts            # Messaging helpers
├── lib/                          # Utilities
│   ├── supabase/                 # Supabase clients
│   ├── types.ts                  # TypeScript types
│   ├── utils.ts                  # Helper functions
│   ├── validation.ts             # Input validation
│   └── profile.ts                # Profile utilities
├── supabase/                     # Database
│   ├── schema.sql                # Complete schema
│   └── migrations/               # Migration files
├── DEPLOYMENT_GUIDE.md           # Deployment instructions
├── IMPLEMENTATION_SUMMARY.md     # Feature summary
└── QUICK_FIX.md                  # TypeScript fixes
```

---

## 🛠️ Tech Stack

- **Framework:** Next.js 16.4.0 (App Router)
- **Language:** TypeScript
- **Backend:** Supabase (PostgreSQL + Auth + Realtime)
- **Styling:** Tailwind CSS 4
- **Deployment:** Vercel
- **UI Components:** Radix UI + Custom Components

---

## 📖 Documentation

- **[Deployment Guide](DEPLOYMENT_GUIDE.md)** - Complete deployment instructions
- **[Implementation Summary](IMPLEMENTATION_SUMMARY.md)** - Feature overview and status
- **[Quick Fix Guide](QUICK_FIX.md)** - TypeScript error fixes

---

## 🔒 Security

- All tables protected by Row Level Security (RLS)
- Role-based access control enforced at database level
- Faculty role requires admin approval
- Messages restricted to connected users only
- Input validation and sanitization
- Secure password requirements (minimum 6 characters)

---

## 🧪 Testing

### Test Student Flow
1. Sign up as student with USN
2. Browse student directory at `/people`
3. Send connection request
4. Accept request from another account
5. Send message to connected user

### Test Faculty Flow
1. Request faculty access at `/signup/faculty`
2. Wait for admin approval (or approve yourself if admin)
3. Access faculty dashboard at `/faculty/dashboard`
4. Create announcement
5. Verify announcement appears in feed

### Test Admin Flow
1. Set your role to admin in database
2. Go to `/admin`
3. Review pending faculty applications
4. Approve or reject applications

---

## 📊 Database Schema

Key tables:
- `profiles` - User profiles (single source of truth)
- `connection_requests` - Connection system
- `conversations` + `messages` - Messaging
- `faculty_applications` - Faculty approval workflow
- `announcements` - Faculty announcements
- `posts`, `events`, `comments` - Community content
- `notifications` - Real-time notifications

See `supabase/schema.sql` for complete schema.

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📝 License

This project is for educational purposes for UBDT CSE students and faculty.

---

## 👨‍💻 Developer

**Shreyas Jadhav**  
GitHub: [@Shreyas-a-j](https://github.com/Shreyas-a-j)

---

## 🙏 Acknowledgments

- Built with assistance from Claude Code
- Next.js documentation and community
- Supabase for backend infrastructure
- Radix UI for accessible components

---

## 📞 Support

For issues or questions:
1. Check the [Deployment Guide](DEPLOYMENT_GUIDE.md)
2. Review [Implementation Summary](IMPLEMENTATION_SUMMARY.md)
3. Search existing GitHub issues
4. Create new issue with details

---

## 🎯 Roadmap

### Completed ✅
- Student networking and connections
- One-to-one messaging
- Faculty portal and approvals
- Admin dashboard
- Real-time notifications
- Mobile-responsive UI

### Planned 🚧
- Connection recommendations
- Read receipts for messages
- Typing indicators
- Group chats
- File attachments
- Email notifications
- Advanced search
- Analytics dashboard

---

## 🆕 Latest Updates

### v1.1 (October 14, 2026)
- Completed the v1.1 upgrade baseline across networking, messaging, faculty, and admin flows.
- Resolved Vitest/Node typings dependency conflict by pinning `@types/node` to `^22.20.5`.

---

**Version:** 1.1.0  
**Last Updated:** October 14, 2026  
**Status:** Production Ready ✅
