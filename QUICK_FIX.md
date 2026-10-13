# Quick Fix Guide for TypeScript Errors

Run these commands in your project directory to fix all remaining TypeScript errors:

```bash
# Navigate to project
cd /home/shreyas/Downloads/antigravity_projects/community

# Fix 1: Replace 'description=' with 'body=' in EmptyState components
find app -name "*.tsx" -type f -print0 | xargs -0 sed -i 's/description=/body=/g'

# Fix 2: Fix ConnectButton prop in profile page
sed -i 's/targetUserId=/otherUserId=/g' app/people/[id]/page.tsx

# Fix 3: Run build to verify
npm run build

# If build succeeds, commit changes
git add .
git commit -m "fix: resolve TypeScript prop mismatches in new pages"
git push origin main
```

## Expected Result

After running these commands, the build should succeed with:
```
✓ Compiled successfully
✓ Type checking passed
✓ Build completed
```

## If Build Still Fails

Check for any remaining errors and run:
```bash
npm run build 2>&1 | grep "error TS"
```

Then manually fix any remaining type errors in the listed files.

## Deploy to Vercel

Once the build passes locally:
```bash
git push origin main
```

Vercel will automatically deploy the changes.

## Apply Database Migration

In Supabase SQL Editor, run:
```sql
-- Copy contents from: supabase/migrations/20261013_network_and_faculty.sql
-- Then reload schema:
NOTIFY pgrst, 'reload schema';
```

## Create First Admin

```sql
UPDATE profiles 
SET role = 'admin' 
WHERE email = 'your-email@example.com';
```

## Test the Application

1. Visit https://ubdt-cse-community.vercel.app/
2. Sign up as a student
3. Browse /people directory
4. Send connection requests
5. Test messaging after connecting
6. Sign up as faculty (will be pending)
7. Login as admin at /admin
8. Approve faculty application
9. Login as faculty and create announcement
