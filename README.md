# Ninja ATS — Mini Applicant Tracking System

A full-stack Mini Applicant Tracking System (ATS) built with **Next.js**, **shadcn/ui**, **Express**, and **Supabase (PostgreSQL, Auth & Storage)**.

Built as a take-home assignment focusing on practical async programming, server-side validation, and concurrency handling.

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router), shadcn/ui, Tailwind CSS, TanStack Query v5
- **Backend**: Node.js, Express 5, TypeScript, Zod
- **Database & Storage**: Supabase (Postgres, Auth, Storage, Row-Level Security)
- **Testing**: Vitest, Supertest, Autocannon

---

## Features

- **Role-based Auth**: Separate experiences for Recruiters (create jobs, manage applicants) and Candidates (browse jobs, apply with resume).
- **Stage Progression Rules**: Applications move in order (`applied -> screening -> interview -> offer -> rejected`). Moving a rejected candidate or skipping stages is blocked server-side with a 400 error.
- **Authorization**: Recruiter A cannot see or edit Recruiter B's applicants (403 Forbidden). Enforced in both Express code and Supabase RLS.
- **No Duplicate Applies**: Candidates cannot apply twice to the same job (blocked by a database unique constraint, returns 409 Conflict).
- **Concurrency Limiter (Part 3.2)**: Hand-written queue for bulk stage changes that limits in-flight database updates to 5 at a time and preserves input order.
- **Streamed CSV Export (Part 3.3)**: Exports 10,000+ rows in 1,000-row chunks using `setImmediate` so the Node event loop never freezes.
- **Background Email (Part 3.4)**: Application confirmation emails run in the background with automatic retries so the applicant doesn't wait.
- **Race Condition Protection (Part 3.5)**: Uses optimistic locking (`version` column) so two recruiters editing the same candidate at the same time don't overwrite each other.
- **Debounced Search (Part 3.6)**: Hand-crafted search debounce in the frontend with request cancellation to prevent stale results.

---

## Setup & Running Locally

### 1. Prerequisites
- Node.js (v20 or higher)
- `npm` and `pnpm` (`npm install -g pnpm`)

### 2. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/ninja-hire-assignment.git
cd ninja-hire-assignment
```

### 3. Backend Setup

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Create your `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
   Add your Supabase credentials to `backend/.env`:
   ```env
   PORT=4000
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_DB_PASSWORD=your_db_password
   SUPABASE_PUBLIC_KEY=your_supabase_anon_key
   SUPABASE_SECRET_KEY=your_supabase_service_role_key
   FRONTEND_ORIGIN=http://localhost:3000
   ```

3. Run the database migrations:
   Run the SQL file in `supabase/supabase/migrations/20261111101848_create_profiles.sql` using the Supabase CLI or paste it into your Supabase Dashboard SQL Editor and click **Run**.

4. Seed the database with sample jobs and applicants:
   ```bash
   npm run seed
   ```

5. Start the backend:
   ```bash
   npm run dev
   ```
   The backend will be live at `http://localhost:4000`.

### 4. Frontend Setup

1. In a new terminal, go to the `frontend` folder:
   ```bash
   cd frontend
   pnpm install
   ```

2. Create `.env.local` inside `frontend/`:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   NEXT_PUBLIC_API_URL=http://localhost:4000
   ```

3. Start the Next.js frontend:
   ```bash
   pnpm dev
   ```
   Open `http://localhost:3000` in your browser.

---

## Test Accounts (from Seed Script)

You can log in with these seeded accounts:

- **Recruiter**: `recruiter1@techcorp.com` / `Password123!`
- **Other Recruiter**: `recruiter2@startup.io` / `Password123!` (use to test that Recruiter 2 cannot see Recruiter 1's jobs)
- **Candidate**: `candidate1@example.com` / `Password123!`

---

## Running the Tests

To run the Vitest test suite covering authorization, stage transition rules, duplicate prevention, and race conditions:

```bash
cd backend
npm test
```

---

## Documentation

- **[ASYNC.md](file:///e:/Projects/ninja-hire-assignment/ASYNC.md)**: Explanations, code references, and test results for all Part 3 async questions.
- **[DESIGN.md](file:///e:/Projects/ninja-hire-assignment/DESIGN.md)**: Database schema choices, scaling plans for 5M applicants, and tradeoffs.
