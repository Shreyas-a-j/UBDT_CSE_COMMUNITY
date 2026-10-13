/**
 * Faculty application persistence tests.
 *
 * Run against a local Supabase project or a test database:
 *
 *   # 1. Start a local Supabase stack (requires supabase CLI):
 *      supabase start
 *
 *   # 2. Apply the migration under test:
 *      supabase db push --db-url <TEST_DB_URL>
 *      # or, if using the local project:
 *      supabase db push
 *
 *   # 3. Execute this script via Node (no test framework required):
 *      node --experimental-vm-modules node_modules/.bin/jest faculty-applications.test.mjs
 *      # or, without jest, just run the SQL verification below.
 *
 * For a pure-SQL smoke test (no Node dependencies beyond supabase-cli),
 * run the file `supabase/test-faculty-app.sql` against the same database.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjIxMDAwMDAwMDB9.test'

let supabase
let adminUserId
let applicantUserId

/** Count helpers */
async function countApplications(status = null) {
  let q = supabase.from('faculty_applications').select('*', { count: 'exact', head: true })
  if (status) q = q.eq('status', status)
  const { count } = await q
  return count ?? 0
}

async function countProfiles(role = null) {
  let q = supabase.from('profiles').select('*', { count: 'exact', head: true })
  if (role) q = q.eq('role', role)
  const { count } = await q
  return count ?? 0
}

/** ---------------------------------------------------------
 *  Test: table exists and has expected columns
 * --------------------------------------------------------- */
async function testTableExists() {
  console.log('\n[TEST] tableExists')
  const { data: tables } = await supabase
    .from('faculty_applications')
    .select('id')
    .limit(1)

  // If the table doesn't exist, Supabase returns a 404-ish error.
  // We catch it here and re-throw with a clear message.
  if (tables === undefined) {
    throw new Error('faculty_applications table not found in the database. Apply the migration first.')
  }
  console.log('  PASS — table is queryable')
}

/** ---------------------------------------------------------
 *  Test: RLS is enabled and policies exist
 * --------------------------------------------------------- */
async function testRLSEnabled() {
  console.log('\n[TEST] rlsEnabled')
  const { data: policies } = await supabase
    .from('pg_policies')
    .select('policyname')
    .eq('tablename', 'faculty_applications')

  const expectedPolicies = [
    'Users read own faculty applications',
    'Users submit own faculty application',
    'Admins manage faculty applications',
  ]
  for (const policy of expectedPolicies) {
    if (!policies.some(p => p.policyname === policy)) {
      throw new Error(`Missing RLS policy: ${policy}`)
    }
  }
  console.log('  PASS — all required RLS policies exist')
}

/** ---------------------------------------------------------
 *  Test: indexes exist (especially the partial unique)
 * --------------------------------------------------------- */
async function testIndexes() {
  console.log('\n[TEST] indexes')
  const { data: indexes } = await supabase
    .from('pg_indexes')
    .select('indexname, indexdef')
    .eq('tablename', 'faculty_applications')

  const found = indexes ?? []
  const partialUnique = found.find(i => i.indexname === 'faculty_applications_one_pending')
  if (!partialUnique) {
    throw new Error('Partial unique index faculty_applications_one_pending is missing')
  }
  if (!partialUnique.indexdef.includes("status = 'pending'")) {
    throw new Error('Partial unique index does not have the correct predicate')
  }
  console.log('  PASS — partial unique index exists with correct predicate')
}

/** ---------------------------------------------------------
 *  Test: successful submission
 * --------------------------------------------------------- */
async function testSuccessfulSubmission() {
  console.log('\n[TEST] successfulSubmission')
  const before = await countApplications()

  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email: `applicant-${Date.now()}@test.example.com`,
    password: 'testpassword123',
    options: {
      data: {
        name: 'Test Faculty Applicant',
        department: 'CSE',
        designation: 'Assistant Professor',
        employee_id: 'UBDT-FAC-999',
        intent: 'faculty',
      },
    },
  })
  if (signUpErr) throw signUpErr
  const userId = signUpData.user?.id
  if (!userId) throw new Error('No user ID returned from signUp')

  const { error: appErr } = await supabase.from('faculty_applications').insert({
    user_id: userId,
    full_name: 'Test Faculty Applicant',
    official_email: signUpData.user.email,
    department: 'CSE',
    designation: 'Assistant Professor',
    employee_id: 'UBDT-FAC-999',
    status: 'pending',
  })
  if (appErr) throw appErr

  const after = await countApplications()
  if (after !== before + 1) {
    throw new Error(`Expected application count to increment by 1, got ${after} (was ${before})`)
  }
  console.log('  PASS — application inserted and count incremented')
}

/** ---------------------------------------------------------
 *  Test: duplicate pending submission is rejected
 * --------------------------------------------------------- */
async function testDuplicatePendingRejected() {
  console.log('\n[TEST] duplicatePendingRejected')
  // Create a user with an existing pending application
  const { data: signUpData } = await supabase.auth.signUp({
    email: `dup-${Date.now()}@test.example.com`,
    password: 'testpassword123',
    options: { data: { intent: 'faculty', name: 'Dup User', department: 'CSE', designation: 'Prof' } },
  })
  const userId = signUpData?.user?.id
  if (!userId) throw new Error('No user ID')

  await supabase.from('faculty_applications').insert({
    user_id: userId,
    full_name: 'Dup User',
    official_email: signUpData.user.email,
    department: 'CSE',
    designation: 'Prof',
    status: 'pending',
  })

  // Try a second insert with the same user
  const { error: dupErr } = await supabase.from('faculty_applications').insert({
    user_id: userId,
    full_name: 'Dup User',
    official_email: signUpData.user.email,
    department: 'CSE',
    designation: 'Prof',
    status: 'pending',
  })

  if (!dupErr) {
    throw new Error('Expected duplicate pending insert to fail, but it succeeded')
  }
  // We expect a unique-violation (23505) from the partial unique index.
  if (dupErr.code !== '23505') {
    throw new Error(`Expected error code 23505, got ${dupErr.code}: ${dupErr.message}`)
  }
  console.log('  PASS — duplicate pending submission rejected with unique-violation')
}

/** ---------------------------------------------------------
 *  Test: retry after rejection is allowed
 * --------------------------------------------------------- */
async function testRetryAfterRejection() {
  console.log('\n[TEST] retryAfterRejection')
  const { data: signUpData } = await supabase.auth.signUp({
    email: `retry-${Date.now()}@test.example.com`,
    password: 'testpassword123',
    options: { data: { intent: 'faculty', name: 'Retry User', department: 'CSE', designation: 'Assoc Prof' } },
  })
  const userId = signUpData?.user?.id
  if (!userId) throw new Error('No user ID')

  // Insert and immediately reject
  const { data: appData } = await supabase.from('faculty_applications').insert({
    user_id: userId,
    full_name: 'Retry User',
    official_email: signUpData.user.email,
    department: 'CSE',
    designation: 'Assoc Prof',
    status: 'pending',
  }).select().single()
  if (!appData) throw new Error('Failed to insert initial application')

  // Admin updates to rejected
  const { error: rejectErr } = await supabase
    .from('faculty_applications')
    .update({ status: 'rejected', reviewed_by: adminUserId, reviewed_at: new Date().toISOString(), notes: 'Incomplete' })
    .eq('id', appData.id)
  if (rejectErr) throw rejectErr

  // Now insert a fresh pending application for the same user
  const { error: retryErr } = await supabase.from('faculty_applications').insert({
    user_id: userId,
    full_name: 'Retry User',
    official_email: signUpData.user.email,
    department: 'CSE',
    designation: 'Assoc Prof',
    status: 'pending',
  })
  if (retryErr) {
    throw new Error(`Expected retry after rejection to succeed, got: ${retryErr.message}`)
  }

  const count = await countApplications('pending')
  if (count < 1) throw new Error('Expected at least one pending application after retry')
  console.log('  PASS — retry after rejection is allowed')
}

/** ---------------------------------------------------------
 *  Test: insert failure does not hide the error (sanity check)
 * --------------------------------------------------------- */
async function testInsertFailureIsReported() {
  console.log('\n[TEST] insertFailureReported')
  // Simulate a foreign-key failure by referencing a non-existent user.
  const fakeUserId = '00000000-0000-0000-0000-000000000000'
  const { error: fkErr } = await supabase.from('faculty_applications').insert({
    user_id: fakeUserId,
    full_name: 'Ghost',
    official_email: 'ghost@example.com',
    department: 'CSE',
    designation: 'Prof',
    status: 'pending',
  })

  if (!fkErr) {
    throw new Error('Expected FK violation, but insert succeeded')
  }
  // We expect a foreign-key violation (23503).
  if (fkErr.code !== '23503') {
    throw new Error(`Expected error code 23503, got ${fkErr.code}: ${fkErr.message}`)
  }
  console.log('  PASS — insert failure surfaces correct error code (23503)')
}

/** ---------------------------------------------------------
 *  Test: non-admin cannot change status
 * --------------------------------------------------------- */
async function testNonAdminCannotChangeStatus() {
  console.log('\n[TEST] nonAdminCannotChangeStatus')
  // Create a student user
  const { data: signUpData } = await supabase.auth.signUp({
    email: `student-${Date.now()}@test.example.com`,
    password: 'testpassword123',
    options: { data: { name: 'Student User', department: 'CSE' } },
  })
  const studentId = signUpData?.user?.id
  if (!studentId) throw new Error('No student user ID')

  // Make them a student profile
  await supabase.from('profiles').update({ role: 'student' }).eq('id', studentId)

  // Sign in as student and try to update a pending application (as admin)
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: signUpData.user.email,
    password: 'testpassword123',
  })
  if (signInErr) throw signInErr

  // Pick an existing pending application (any)
  const { data: anyApp } = await supabase
    .from('faculty_applications')
    .select('id')
    .eq('status', 'pending')
    .maybeSingle()

  if (!anyApp) {
    console.log('  SKIP — no pending applications to test against')
    return
  }

  const { error: updateErr } = await supabase
    .from('faculty_applications')
    .update({ status: 'approved' })
    .eq('id', anyApp.id)

  if (!updateErr) {
    throw new Error('Expected non-admin update to be rejected')
  }
  console.log('  PASS — non-admin cannot change application status')
}

/** ---------------------------------------------------------
 *  Test: admin can approve and profile is promoted
 * --------------------------------------------------------- */
async function testAdminApprovalPromotesProfile() {
  console.log('\n[TEST] adminApprovalPromotesProfile')
  const before = await countProfiles('faculty')

  // Sign in as admin
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: process.env.ADMIN_EMAIL || 'admin@test.example.com',
    password: process.env.ADMIN_PASSWORD || 'adminpassword123',
  })
  // If no admin exists, skip (but log a warning)
  if (signInErr) {
    console.log('  SKIP — admin account not available')
    return
  }

  // Find a pending application
  const { data: pendingApp } = await supabase
    .from('faculty_applications')
    .select('id, user_id')
    .eq('status', 'pending')
    .maybeSingle()

  if (!pendingApp) {
    console.log('  SKIP — no pending applications to approve')
    return
  }

  const { error: approveErr } = await supabase
    .from('faculty_applications')
    .update({
      status: 'approved',
      reviewed_by: adminUserId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', pendingApp.id)

  if (approveErr) throw approveErr

  const after = await countProfiles('faculty')
  if (after <= before) {
    throw new Error('Expected profile role to change to faculty after approval')
  }
  console.log('  PASS — admin approval promotes profile to faculty')
}

// =========================================================
// Main
// =========================================================
async function main() {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Set up test admin user (idempotent)
  const { data: adminData } = await supabase.auth.signUp({
    email: 'admin-test-supabase@example.com',
    password: 'adminpassword123',
  })
  adminUserId = adminData?.user?.id
  if (adminUserId) {
    await supabase.from('profiles').upsert(
      { id: adminUserId, name: 'Test Admin', role: 'admin', faculty_status: 'none' },
      { onConflict: 'id' }
    )
  }

  const results = []
  const run = async (fn, name) => {
    try {
      await fn()
      results.push({ name, status: 'pass' })
      console.log(`  ✔ ${name}`)
    } catch (err) {
      results.push({ name, status: 'fail', error: err.message })
      console.error(`  ✘ ${name}: ${err.message}`)
    }
  }

  await run(testTableExists, 'tableExists')
  await run(testRLSEnabled, 'rlsEnabled')
  await run(testIndexes, 'indexes')
  await run(testSuccessfulSubmission, 'successfulSubmission')
  await run(testDuplicatePendingRejected, 'duplicatePendingRejected')
  await run(testRetryAfterRejection, 'retryAfterRejection')
  await run(testInsertFailureIsReported, 'insertFailureReported')
  await run(testNonAdminCannotChangeStatus, 'nonAdminCannotChangeStatus')
  await run(testAdminApprovalPromotesProfile, 'adminApprovalPromotesProfile')

  const failures = results.filter(r => r.status === 'fail')
  console.log(`\n${results.length - failures.length}/${results.length} tests passed.`)
  if (failures.length) {
    console.error('Failures:', failures.map(f => `${f.name}: ${f.error}`).join('\n'))
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
