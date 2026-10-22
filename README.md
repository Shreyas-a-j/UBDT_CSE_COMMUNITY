# 🎓 UBDT CSE Community

**A digital community platform for the Computer Science and Engineering department at UBDT College of Engineering.**

Connect with fellow students, discover people with shared interests, exchange messages, and stay informed about faculty announcements and academic events—all in one place.

[![Next.js](https://img.shields.io/badge/Next.js-16.3.8-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Backend-Supabase-3FCF8E?logo=supabase)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss)](https://tailwindcss.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Deployment-Cloudflare_Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)

**Live website:** [UBDT CSE Community](https://ubdt-cse-community.vercel.app/)

> **Project status:** Active development. The application build and TypeScript checks have succeeded, but the Cloudflare deployment pipeline and production runtime still require verification.

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Technology Stack](#️-technology-stack)
- [Application Routes](#-application-routes)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Database Setup](#️-database-setup)
- [Development Commands](#️-development-commands)
- [Deployment](#-deployment)
- [Security](#-security)
- [Testing](#-testing)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

UBDT CSE Community is a student networking and communication platform designed to bring the department's academic community together.

Instead of relying entirely on scattered messaging groups, students can maintain profiles, discover other students, build connections, and communicate through a centralized application. Faculty members can share academic announcements and manage events, while administrators oversee faculty access and user roles.

The project combines a modern Next.js frontend with Supabase authentication, PostgreSQL data storage, and real-time functionality.

### Project goals

- Make it easier for students to discover and connect with peers.
- Help students find people with relevant skills and interests.
- Provide a dedicated channel for one-to-one communication.
- Centralize faculty announcements and academic events.
- Establish a role-based system for students, faculty, and administrators.

## ✨ Features

### 👥 Student networking

- **Student directory:** Browse and discover students.
- **Search and discovery:** Find people using available profile information, such as names, USNs, skills, and interests.
- **Student profiles:** Display academic information, biographies, skills, and interests.
- **Connection requests:** Send, accept, and reject connection requests.
- **Connection management:** View connections and pending requests.

### 💬 Private messaging

- **One-to-one conversations:** Communicate with connected users.
- **Message history:** Store and retrieve conversations through the database.
- **Real-time updates:** Use Supabase Realtime for message updates.
- **Unread indicators:** Track unread messages and conversations.

### 👨‍🏫 Faculty portal

- **Faculty directory:** Discover verified faculty members.
- **Faculty applications:** Request faculty access through the application workflow.
- **Approval workflow:** Submit applications for administrator review.
- **Announcements:** Publish information for the student community.
- **Academic events:** Create and manage workshops, seminars, and academic sessions.
- **Faculty dashboard:** Access faculty-oriented management features.

### ⚙️ Administration

- **Faculty approval:** Review, approve, or reject faculty applications.
- **Role management:** Manage user access and roles.
- **Application tracking:** Review faculty application statuses.
- **Administrative dashboard:** Access administrative workflows.

### 🔐 Authentication and access control

- Supabase-based authentication.
- Student and faculty registration flows.
- Role-aware application features.
- Protected application routes.
- Database access policies through Supabase Row Level Security (RLS).

### 📱 User experience

- Responsive interface for desktop and mobile.
- Reusable UI components.
- Modern styling with Tailwind CSS.
- Accessible interface primitives from Radix UI.

> Features described here reflect the intended application functionality. Their availability and security should be verified against the current deployment and database configuration.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.3.8, App Router |
| Language | TypeScript |
| UI library | React 19 |
| Styling | Tailwind CSS 4 |
| UI primitives | Radix UI |
| Icons | Lucide React |
| Backend platform | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Real-time functionality | Supabase Realtime |
| Object storage | Cloudflare R2 integration |
| Cloudflare adapter | OpenNext for Cloudflare |
| Edge runtime | Cloudflare Workers |
| Additional deployment configuration | Vercel |

### Why this stack?

- **Next.js:** Provides routing, server rendering, static generation, and API endpoints.
- **TypeScript:** Adds static type checking and helps prevent common programming errors.
- **Supabase:** Provides authentication, relational data storage, and real-time capabilities.
- **Tailwind CSS:** Supports consistent, responsive styling.
- **Cloudflare Workers and OpenNext:** Provide an edge deployment path for the Next.js application.
- **Cloudflare R2:** Supports object-storage workflows used by the application.

---

## 🗺️ Application Routes

The current application includes the following primary routes.

| Route | Purpose |
|---|---|
| `/` | Community homepage |
| `/signin` | Sign in |
| `/signup` | Student registration |
| `/signup/faculty` | Faculty registration or access request |
| `/people` | Student directory |
| `/people/[id]` | Individual profile |
| `/connections` | Connection management |
| `/messages` | Messaging inbox |
| `/messages/[id]` | Individual conversation |
| `/faculty` | Faculty directory |
| `/faculty/dashboard` | Faculty dashboard |
| `/faculty/announcements/create` | Create an announcement |
| `/admin` | Administrative dashboard |
| `/api/admin/faculty` | Faculty administration API |
| `/api/admin/faculty/[id]` | Individual faculty administration API |
| `/api/r2-signed-url` | R2 signed URL workflow |
| `/api/r2-upload` | R2 upload workflow |
| `/auth/callback` | Authentication callback |

Protected routes and API endpoints may require authentication and appropriate permissions.

---

## 🏗️ Architecture

At a high level, the application follows this structure:

```text
                         Users
                           |
                           v
                  Next.js Application
                  /        |         \
                 /         |          \
                v          v           v
          UI Components  Auth Flow   API Routes
                |          |           |
                |          v           v
                |      Supabase     Cloudflare R2
                |          |
                v          v
             React     PostgreSQL
                           |
                           v
                    Supabase Realtime
```

The main application areas are:

- **Presentation:** Pages, layouts, and reusable UI components.
- **Authentication:** Supabase client configuration and shared authentication state.
- **Community functionality:** Profiles, connections, and messaging.
- **Faculty and administration:** Role-specific interfaces and management workflows.
- **Data layer:** Supabase queries, PostgreSQL schema, and access policies.
- **Storage:** R2-related upload and signed URL endpoints.

---

## 🚀 Getting Started

### Prerequisites

Install the following before running the project:

- Node.js and npm versions compatible with the project's dependencies.
- Git.
- A Supabase project.
- A configured environment file.
- Cloudflare credentials if you intend to build, preview, or deploy through Cloudflare.

### 1. Clone the repository

```bash
git clone https://github.com/Shreyas-a-j/UBDT_CSE_COMMUNITY.git
cd UBDT_CSE_COMMUNITY
```

### 2. Install dependencies

```bash
npm ci
```

Use `npm install` instead if you intentionally need to update the dependency lockfile.

### 3. Configure environment variables

If the repository contains `.env.example`, copy it:

```bash
cp .env.example .env.local
```

Otherwise, create `.env.local` in the project root.

At minimum, configure the Supabase client variables:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLIC_KEY
```

Replace the placeholders with the actual URL and public client key from your Supabase project.

If the current code uses additional server-side or object-storage variables, configure those according to the repository's deployment guide and environment-variable definitions.

### 4. Set up the database

1. Open your Supabase project.
2. Open the SQL Editor.
3. Review the migrations in `supabase/migrations/`.
4. Apply the required migrations in the intended order.
5. Verify the database tables, relationships, triggers, and RLS policies.
6. Reload the PostgREST schema cache if required by a migration.

The existing project documentation references:

`supabase/migrations/2026101301_network_and_faculty.sql`

Confirm that this migration is present and applicable before running it. Avoid rerunning non-idempotent SQL migrations blindly.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 🔑 Environment Variables

| Variable | Purpose | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public client key | Public |

These are the core variables used by the browser Supabase client. Other variables may be required by API routes or the R2 integration; check the current implementation and deployment configuration for their exact names.

### Security notes

- Never commit `.env.local` or other files containing credentials.
- Never expose a Supabase service-role key using a `NEXT_PUBLIC_` variable.
- Store server-only credentials in the appropriate deployment environment.
- Ensure that R2 credentials remain server-side.
- Treat public client keys as public identifiers, not as a substitute for database access policies.

---

## 🗄️ Database Setup

The application uses Supabase PostgreSQL.

The current project documentation identifies these principal data areas:

| Table or data area | Purpose |
|---|---|
| `profiles` | User profiles and academic information |
| `connection_requests` | Connection request workflow |
| `conversations` | Conversation records |
| `messages` | Message history |
| `faculty_applications` | Faculty access requests and approval |
| `announcements` | Faculty announcements |
| `posts`, `events`, `comments` | Community content, where configured |
| `notifications` | Notification records, where configured |

The exact schema depends on the migrations actually applied to your Supabase project. Refer to `supabase/schema.sql` and the migration files as the source of truth.

Before deploying schema changes, verify that application queries match the actual column names and data types. Also confirm that profile creation, faculty approval, and message access have the necessary policies and triggers.

---

## 🧰 Development Commands

The repository defines the following npm scripts:

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Run the Next.js production build |
| `npm run start` | Start the Next.js production server |
| `npm run lint` | Run ESLint |
| `npm run cf:build` | Build the application using OpenNext for Cloudflare |
| `npm run cf:preview` | Preview the OpenNext Cloudflare build locally |
| `npm run cf:deploy` | Build and deploy through the OpenNext Cloudflare adapter |
| `npm run cf:typegen` | Generate Cloudflare Worker types |

Before opening a pull request, run the checks relevant to your changes:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

For Cloudflare-specific changes, also test:

```bash
npm run cf:build
npm run cf:preview
```

---

## ☁️ Deployment

### Vercel

The repository has a Vercel deployment configuration.

1. Import the GitHub repository into Vercel.
2. Configure the required environment variables.
3. Verify that the selected Next.js version and build settings match the repository.
4. Deploy the project.
5. Test authentication, protected routes, database access, and API endpoints.

### Cloudflare Workers with OpenNext

The project also includes Cloudflare Worker configuration and OpenNext scripts.

The intended workflow is:

```bash
npm run cf:build
npm run cf:preview
npm run cf:deploy
```

Before deploying:

- Verify that `wrangler.jsonc` names the intended Worker.
- Confirm that `WORKER_SELF_REFERENCE` matches the intended self-referencing Worker configuration.
- Verify the R2 cache bucket exists and the binding is correct.
- Preserve the `ASSETS` and `IMAGES` bindings.
- Configure required environment variables for the Cloudflare environment.
- Test the built Worker locally before production deployment.

**Deployment note:** A successful Next.js build does not guarantee a successful OpenNext build or a working Worker runtime. The Cloudflare pipeline previously reported a missing compiled OpenNext configuration, and the deployed Worker previously threw a runtime exception while loading Next.js preview props. These issues must be verified against the current build and deployment before considering Cloudflare production-ready.

---

## 🔒 Security

Security is especially important because the application handles student profiles, private messages, and faculty permissions.

Recommended checks include:

- Enforce Row Level Security on tables containing user-specific data.
- Restrict private messages to authorized conversation participants.
- Verify faculty approval before granting faculty privileges.
- Check administrator permissions on both pages and API endpoints.
- Validate request payloads on the server.
- Keep storage credentials and privileged API keys server-side.
- Avoid logging authentication tokens or other sensitive information.
- Test unauthorized access to protected routes and API endpoints.
- Confirm that public profile visibility matches the intended privacy model.

Client-side route protection alone is not sufficient for sensitive operations; authorization must also be enforced server-side and at the database level.

---

## 🧪 Testing Checklist

### Student workflow

- [ ] Register a student account.
- [ ] Sign in and sign out.
- [ ] Create or update a profile.
- [ ] Browse the student directory.
- [ ] Send and respond to connection requests.
- [ ] Start a conversation with an authorized connection.
- [ ] Verify that message history persists.

### Faculty workflow

- [ ] Submit a faculty access request.
- [ ] Verify the pending application state.
- [ ] Approve or reject the application as an administrator.
- [ ] Confirm that faculty access follows the approval state.
- [ ] Create an announcement.
- [ ] Verify announcement visibility to the intended users.

### Administrator workflow

- [ ] Open the admin dashboard with an authorized account.
- [ ] Review faculty applications.
- [ ] Approve or reject an application.
- [ ] Verify that unauthorized users cannot access admin operations.

### Deployment workflow

- [ ] Confirm the production build passes.
- [ ] Confirm the OpenNext build passes.
- [ ] Verify the homepage renders on the deployed Worker.
- [ ] Refresh nested routes directly.
- [ ] Test authentication and database operations in production.
- [ ] Inspect Worker logs for runtime exceptions.

---

## 🗺️ Roadmap

### Current focus

- [ ] Stabilize the Cloudflare OpenNext build and deployment pipeline.
- [ ] Verify the production Worker runtime.
- [ ] Validate Supabase schema compatibility and profile creation.
- [ ] Test role-based authorization and RLS policies.
- [ ] Document all required environment variables.

### Potential future enhancements

- [ ] Connection recommendations.
- [ ] Message read receipts.
- [ ] Typing indicators.
- [ ] Group conversations.
- [ ] File attachments.
- [ ] Email notifications.
- [ ] Advanced people search.
- [ ] Expanded community analytics.

Future items are proposals, not promises of implementation.

---

## 🤝 Contributing

Contributions, bug reports, and suggestions are welcome.

1. Fork the repository.
2. Create a feature branch:

   ```bash
   git checkout -b feature/your-feature
   ```

3. Make focused changes.
4. Run the relevant checks.
5. Commit your changes:

   ```bash
   git commit -m "feat: describe your change"
   ```

6. Push the branch:

   ```bash
   git push origin feature/your-feature
   ```

7. Open a pull request with a description of the change and its testing results.

Please do not include credentials, private user data, or production secrets in commits.

---

## 📚 Documentation

- [Deployment Guide](DEPLOYMENT_GUIDE.md)
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md)
- [Quick Fix Guide](QUICK_FIX.md)
- [Supabase schema](supabase/schema.sql)
- [Supabase migrations](supabase/migrations/)

Check that these files exist in the repository before relying on their contents.

---

## 👨‍💻 Maintainer

**Shreyas Jadhav**

- GitHub: [@Shreyas-a-j](https://github.com/Shreyas-a-j)
- Repository: [UBDT_CSE_COMMUNITY](https://github.com/Shreyas-a-j/UBDT_CSE_COMMUNITY)

## 📄 License

No explicit open-source license is asserted here. Check the repository for a `LICENSE` file and specify the applicable license before redistributing the project.

---

**Last updated:** October 15, 2026  
**Project:** UBDT CSE Community  
**Status:** Active development; deployment verification in progress.
