# 🎓 UBDT CSE Community App

A modern, feed-first community and collaboration web portal built exclusively for the students of the **Department of Computer Science & Engineering, UBDT College of Engineering, Davangere** ([ubdtce.org](https://ubdtce.org)).

Inspired by the Codecademy Community feed, this application connects ~480 CSE students across all four academic batches (120 intake/year) for hosting virtual workshops, meetings, project showcases, and peer learning.

---

## 🚀 Key Features

1. **Identity & Authentication**
   - Unique identifier: **VTU USN** (University Seat Number, e.g., `1UB21CS099`, `1UB22CS078`, `1UB23CS045`, `1UB24CS012`).
   - Academic Year auto-derived from USN admission year (1st, 2nd, 3rd, 4th Year).
   - Fixed department: **Computer Science & Engineering (CSE)**.
   - Profile management with customizable bio, avatar URL, and skills tags.
   - **1-Click Test Persona Switcher**: Instantly switch roles between 1st, 2nd, 3rd, and 4th-year students to test the experience across all cohorts.

2. **Feed-First Community Layout**
   - **Filter Tabs**: `All Feed`, `Events`, `Discussions`, `Showcases`.
   - **Batch Filter Chips**: `All`, `1st Year`, `2nd Year`, `3rd Year`, `4th Year`.
   - **Real-Time Search**: Search through posts, events, authors, USNs, and tech stack tags.

3. **Virtual Workshops & Events**
   - Create and schedule workshops, meetings, or project reviews.
   - Dynamic countdown timer (`Starts in 1d 12h`, `Starts in 45m`, etc.).
   - Interactive **RSVP toggle** with real-time attendee counts.
   - Direct link integration for virtual sessions (Google Meet, Zoom).

4. **Project Showcases & Peer Reviews**
   - Showcase final year / VTU mini-projects with screenshots.
   - Direct buttons for **Live Demo** and **GitHub Source Code**.
   - Tech stack tags (Next.js, Three.js, Go, PyTorch, FastApi, etc.).
   - Upvotes and comments for peer recognition.

5. **Discussion Threads & Q&A**
   - Ask questions about VTU lab exams, placement preparation, GATE CSE, and hackathons.
   - Likes and threaded comments.
   - Share button with 1-click clipboard link copying.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router + Turbopack)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + UBDT Deep Navy (`#0d1f3c`, `#1e3a5f`) & Gold Accent theme
- **Icons**: Lucide Icons
- **Database / Backend**: Supabase (PostgreSQL with Row Level Security)
- **Local Fallback**: Zero-latency interactive client state with `localStorage` persistence

---

## 📦 Getting Started

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/<your-username>/ubdt-cse-community.git
cd ubdt-cse-community
npm install
```

### 2. Environment Variables

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

> **Note**: Even without Supabase credentials, the app includes a fallback data store with localStorage persistence, allowing you to test creating posts, hosting events, RSVPing, upvoting, commenting, and switching student profiles immediately.

### 3. Database Setup (Supabase)

If using Supabase:
1. Create a new project in the [Supabase Dashboard](https://supabase.com).
2. Open the **SQL Editor** in Supabase.
3. Copy and run the contents of [`supabase/schema.sql`](./supabase/schema.sql). This provisions all tables (`profiles`, `events`, `event_rsvps`, `posts`, `comments`, `likes`, `upvotes`, `notifications`) and enables Row Level Security (RLS) policies.

### 4. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🚢 Deploy to GitHub & Vercel

### Step 1: Push to GitHub

```bash
# Add your GitHub repository remote
git remote add origin https://github.com/<your-username>/ubdt-cse-community.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy to Vercel

1. Log in to [Vercel](https://vercel.com).
2. Click **"Add New..."** -> **"Project"**.
3. Import your `ubdt-cse-community` GitHub repository.
4. Add your environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Click **"Deploy"**.
6. Your community web app is now live with automatic CI/CD on every push!

---

## 🧑‍🎓 Seed Data Test Profiles

| Year | Student Name | USN | Role & Focus |
| :--- | :--- | :--- | :--- |
| **4th Year** | Aditya Patil | `1UB21CS099` | Incoming SDE @ Cisco • DSA & System Design |
| **3rd Year** | Priyanka Murthy | `1UB22CS078` | UBDT Tech Club Lead • Web3 & Full Stack |
| **2nd Year** | Rohan Deshmukh | `1UB23CS045` | AI/ML & Computer Vision • VTU 3rd Sem Labs |
| **1st Year** | Sneha Hegde | `1UB24CS012` | Freshers batch • C Programming & Web basics |

---

## 📄 License

Built for the academic community of UBDT College of Engineering, Davangere.
