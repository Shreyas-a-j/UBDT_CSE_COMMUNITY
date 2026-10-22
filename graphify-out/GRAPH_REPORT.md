# Graph Report - community  (2026-10-20)

## Corpus Check
- 115 files · ~105,770 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 15 file(s) not represented in the graph (top: (none) 3, .sqlite 3, .sqlite-shm 3)

## Summary
- 635 nodes · 1605 edges · 39 communities (23 shown, 16 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 59 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Home Feed & Card UI
- Admin & Faculty Pages
- App Shell & Auth Context
- Supabase Schema Indexes
- Network &Faculty Migration
- Shell & Create Modals
- Admin & R2 API Routes
- Sign In & Sign Up
- Connection Fix Migration
- Database Audit Docs
- UI Screenshots - Feed
- Event Logic & Utils
- README & Deployment Docs
- Schema Audit Report
- Faculty App Test Harness
- Faculty Applications Migration
- Plans & Final Report
- Avatar & Image Processing
- UI Screenshots - Events
- Agent Task Plans
- USN Columns Migration
- Auth Profile Provisioning
- Quick Fix Docs
- ESLint Config
- Delete Policies Migration
- File Icon Asset
- Globe Icon Asset
- Next.js Wordmark
- Vercel Triangle Logo
- Browser Window Icon

## God Nodes (most connected - your core abstractions)
1. `createClient()` - 38 edges
2. `UserAvatar()` - 33 edges
3. `AppShell()` - 29 edges
4. `useCommunity()` - 29 edges
5. `displayName()` - 27 edges
6. `public.profiles` - 26 edges
7. `useAuth()` - 22 edges
8. `EmptyState()` - 19 edges
9. `getYearLabel()` - 19 edges
10. `LoadingSkeleton()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `protect_profile_privileges Conflict Zone` --semantically_similar_to--> `Profile Privilege Role Protection`  [INFERRED] [semantically similar]
  docs/conflict-report.md → .agents/tasks/plan.md
- `Manual Functional Testing Plan` --semantically_similar_to--> `README Testing Checklist`  [INFERRED] [semantically similar]
  docs/deployment-checklist.md → README.md
- `Agent Migration Phase Plan` --conceptually_related_to--> `UBDT CSE Community Upgrade Implementation Plan`  [INFERRED]
  docs/migration-dependency-order.md → .agents/tasks/plan.md
- `First Admin User Provisioning` --semantically_similar_to--> `Manual First Admin Provisioning`  [INFERRED] [semantically similar]
  DEPLOYMENT_GUIDE.md → .agents/tasks/plan.md
- `PostgREST Schema Reload Step` --semantically_similar_to--> `PostgREST Schema Cache Reload`  [INFERRED] [semantically similar]
  DEPLOYMENT_GUIDE.md → .agents/tasks/plan.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Student Networking Feature Rollout** — agents_tasks_implementation_plan_student_network, final_report_student_network, implementation_summary_connection_logic, docs_deployment_checklist_functional_testing [INFERRED 0.75]
- **Privilege Escalation Prevention Pattern** — agents_tasks_plan_faculty_security, docs_conflict_report_profile_privilege_trigger, schema_audit_report_issue5_faculty_application_transition, schema_audit_report_privilege_escalation_prevention, docs_database_audit_security_definer_functions [INFERRED 0.85]
- **Supabase Migration Deployment Workflow** — deployment_guide_migration_apply, deployment_guide_postgrest_schema_reload, agents_tasks_plan_schema_cache_reload, docs_migration_dependency_order_baseline_migrations, docs_deployment_checklist_verification_queries [INFERRED 0.85]

## Communities (39 total, 16 thin omitted)

### Community 0 - "Home Feed & Card UI"
Cohesion: 0.05
Nodes (53): Home(), YEAR_OPTIONS, AnnouncementCard(), DateBlock(), EventCard(), EventCardProps, TYPE_TONE, FilterTab (+45 more)

### Community 1 - "Admin & Faculty Pages"
Cohesion: 0.14
Nodes (45): AdminDashboard(), AdminPage(), ConnectionsManager(), ConnectionsPage(), PersonIdentity(), RowShell(), Tab, TABS (+37 more)

### Community 2 - "App Shell & Auth Context"
Cohesion: 0.05
Nodes (41): inter, jetbrainsMono, metadata, RootLayout(), spaceGrotesk, viewport, AuthContext, AuthContextType (+33 more)

### Community 3 - "Supabase Schema Indexes"
Cohesion: 0.07
Nodes (53): announcements_created_idx, connection_active_pair, connection_addressee_status_idx, connection_pending_pair, connection_requester_status_idx, direct_conversation_pairs_conv_idx, faculty_applications_one_pending, notifications_user_created_idx (+45 more)

### Community 4 - "Network &Faculty Migration"
Cohesion: 0.09
Nodes (40): announcements_created_idx, connection_active_pair, connection_addressee_status_idx, connection_requester_status_idx, conversation_direct_pair, conversation_participants_user_idx, faculty_applications_one_pending, messages_conversation_created_idx (+32 more)

### Community 5 - "Shell & Create Modals"
Cohesion: 0.13
Nodes (26): Footer(), AuthModal(), BATCHES, CommunitySidebar(), CreateEventModal(), CreatePostModal(), flushTurns(), typeContinuously() (+18 more)

### Community 6 - "Admin & R2 API Routes"
Cohesion: 0.10
Nodes (16): POST(), GET(), corsHeaders, isSignedUrlRequestBody(), POST(), SignedUrlRequestBody, corsHeaders, GET() (+8 more)

### Community 7 - "Sign In & Sign Up"
Cohesion: 0.15
Nodes (19): SignInForm(), SignInPage(), FacultySignUpForm(), FacultySignUpPage(), SubmitPhase, PasswordField(), SignUpForm(), SignUpPage() (+11 more)

### Community 8 - "Connection Fix Migration"
Cohesion: 0.10
Nodes (8): trg_connection_transition, trg_enforce_participant_count, trg_faculty_application_transition, trg_protect_profile_privileges, trg_update_announcements_updated_at, trg_update_conversations_updated_at, trg_update_faculty_app_updated_at, trg_update_profiles_updated_at

### Community 9 - "Database Audit Docs"
Cohesion: 0.14
Nodes (17): Cross-Agent Conflict Report, handle_new_user Ownership Rule, protect_profile_privileges Conflict Zone, Profiles Table Structure Conflict Zone, Database Audit Report, Orphaned Auth Users Risk, Realtime Publication Configuration, SECURITY DEFINER Function Inventory (+9 more)

### Community 10 - "UI Screenshots - Feed"
Cohesion: 0.16
Nodes (20): Browser Tab: Feed | Codecademy Community, Career Clubs Section (Alumni Club, CodePsi, Código, Computer Science, Data Science, ELL, Flutter), Codecademy Community Feed Screenshot, Codecademy Community Hub, Start a Post Composer, Dark Theme Three-Column Feed Layout, Events Space, Feed Space (+12 more)

### Community 11 - "Event Logic & Utils"
Cohesion: 0.16
Nodes (9): EVENT_TIME_OFFSET, EventPhase, EventTiming, getEventPhase(), getEventTimes(), isEventUpcoming(), startInstant(), countdownText() (+1 more)

### Community 12 - "README & Deployment Docs"
Cohesion: 0.16
Nodes (12): next dev Agent File Generation, Next.js Agent Rules, UBDT CSE Community Deployment Guide, Supabase Migration Application, Deployment Security Checklist, Deployment Troubleshooting Guide, Vercel Deployment Workflow, Layered Application Architecture (+4 more)

### Community 13 - "Schema Audit Report"
Cohesion: 0.18
Nodes (13): Public Table Inventory, Connection Request Logic, UBDT CSE Community Implementation Summary, Faculty Status Workflow, Phase 1 Bug Fixes and Infrastructure, direct_conversation_pairs Table, Supabase Schema Audit Report, Legacy user_profiles Conditional Sync (+5 more)

### Community 14 - "Faculty App Test Harness"
Cohesion: 0.27
Nodes (12): countApplications(), countProfiles(), main(), testAdminApprovalPromotesProfile(), testDuplicatePendingRejected(), testIndexes(), testInsertFailureIsReported(), testNonAdminCannotChangeStatus() (+4 more)

### Community 15 - "Faculty Applications Migration"
Cohesion: 0.26
Nodes (11): faculty_applications_created_at_idx, faculty_applications_one_pending, faculty_applications_status_idx, faculty_applications_user_status_idx, public.enforce_faculty_application_transition(), public.faculty_applications, public.on_faculty_application_status(), public.update_updated_at_column() (+3 more)

### Community 16 - "Plans & Final Report"
Cohesion: 0.21
Nodes (13): Phase 5 Admin Panel, UBDT CSE Community Implementation Plan, Phase 4 Faculty Portal, Phase 3 One-to-One Messaging, Phase 1 Critical Bug Fixes, Implementation Plan Security Checklist, Phase 2 Student Network and Connections, Admin Panel Delivery (+5 more)

### Community 17 - "Avatar & Image Processing"
Cohesion: 0.26
Nodes (9): Avatar(), AvatarProps, COLOR_PALETTE, getDeterministicColor(), compressAndTokenize(), generateThumbHash(), getScaledDimensions(), loadImage() (+1 more)

### Community 18 - "UI Screenshots - Events"
Cohesion: 0.24
Nodes (12): Codecademy Brand Logo, Career Clubs Sidebar Section, Sidebar Community Section Group, Dark Theme UI Design, No Upcoming Events Empty State, Event Filters and Category Tabs, Events Description Card, Events Purple Hero Banner (+4 more)

### Community 19 - "Agent Task Plans"
Cohesion: 0.20
Nodes (7): UBDT CSE Community Upgrade Implementation Plan, Faculty Role Approval Security, get_or_create_direct_conversation RPC, Profile Privilege Role Protection, PostgREST Schema Cache Reload, First Admin User Provisioning, PostgREST Schema Reload Step

### Community 20 - "USN Columns Migration"
Cohesion: 0.31
Nodes (7): on_auth_user_created, profiles_student_usn_unique, public.handle_new_user(), public.protect_profile_privileges(), public.update_updated_at_column(), trg_protect_profile_privileges, trg_update_profiles_updated_at

### Community 21 - "Auth Profile Provisioning"
Cohesion: 0.38
Nodes (4): on_auth_user_created, public.handle_new_user(), public.protect_profile_privileges(), trg_protect_profile_privileges

### Community 22 - "Quick Fix Docs"
Cohesion: 0.47
Nodes (6): Pre-Deployment TypeScript Prop Fixes, EmptyState description to body Prop Fix, TypeScript Fixes Applied, ConnectButton targetUserId to otherUserId Fix, Quick Fix Guide for TypeScript Errors, sed-Based Prop Rename Fix

## Knowledge Gaps
- **23 isolated node(s):** `Phase 1 Critical Bug Fixes`, `Implementation Plan Security Checklist`, `Faculty Role Approval Security`, `get_or_create_direct_conversation RPC`, `next dev Agent File Generation` (+18 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 154 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createClient()` connect `Admin & Faculty Pages` to `Home Feed & Card UI`, `App Shell & Auth Context`, `Shell & Create Modals`, `Sign In & Sign Up`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `Phase 1 Critical Bug Fixes`, `Implementation Plan Security Checklist`, `Faculty Role Approval Security` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Home Feed & Card UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05060882800608828 - nodes in this community are weakly interconnected._
- **Why does `useCommunity()` connect `Shell & Create Modals` to `Home Feed & Card UI`, `Admin & Faculty Pages`, `App Shell & Auth Context`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Should `Admin & Faculty Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.13509615384615384 - nodes in this community are weakly interconnected._
- **Why does `Profile` connect `App Shell & Auth Context` to `Home Feed & Card UI`, `Admin & Faculty Pages`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Should `App Shell & Auth Context` be split into smaller, more focused modules?**
  _Cohesion score 0.051203277009728626 - nodes in this community are weakly interconnected._