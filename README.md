# 🥋 Ninja ATS — Mini Applicant Tracking System

A production-grade, highly resilient **Mini Applicant Tracking System (ATS)** built with **Next.js (App Router)**, **shadcn/ui**, **Node.js/Express**, and **Supabase (PostgreSQL, Auth & Storage)**.

Designed with an emphasis on **real-world asynchronous architecture**, strict server-side state machines, row-level authorization, and graceful concurrency handling under load.

---

## ⚡ Tech Stack

| Layer                   | Technologies                                                                                                                                                                              |
| :---------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**            | [Next.js 16](https://nextjs.org/) (App Router, Turbopack), [shadcn/ui](https://ui.shadcn.com/), [Tailwind CSS](https://tailwindcss.com/), [TanStack Query v5](https://tanstack.com/query) |
| **Backend**             | [Node.js](https://nodejs.org/), [Express 5](https://expressjs.com/), [TypeScript](https://www.typescriptlang.org/), [Zod](https://zod.dev/) validation                                    |
| **Database & Auth**     | [Supabase](https://supabase.com/) (PostgreSQL 15+, Supabase Auth, Row Level Security, Private Storage)                                                                                    |
| **Testing & Benchmark** | [Vitest](https://vitest.dev/), [Supertest](https://github.com/ladjs/supertest), [Autocannon](https://github.com/mcollina/autocannon)                                                      |

---

## ✨ Key Architectural Features

- **🛡️ Strict Server-Side State Machine**: Application stages follow a validated progression:  
  `applied ➔ screening ➔ interview ➔ offer ➔ rejected`. Moving a `rejected` candidate or skipping stages (e.g., `applied ➔ offer`) is strictly rejected with `HTTP 400`.
- **🔒 True Authorization (Not Just AuthN)**: Enforced both at the Express layer and via PostgreSQL Row-Level Security (RLS). Recruiter A cannot read or modify Recruiter B's applications (`HTTP 403`).
- **🚫 Database-Enforced Duplicate Prevention**: Candidates cannot apply twice to the same job posting via a composite database unique constraint (`UNIQUE(job_id, candidate_id)`), returning `HTTP 409 Conflict`.
- **🚦 Custom Concurrency Limiter (Part 3.2)**: Hand-crafted task queue for `/bulk-stage` (no `p-limit` or libraries) that caps in-flight database updates at **5 concurrent workers**, preserves original array indexing, and utilizes `Promise.allSettled` semantics so single-item failures never abort remaining tasks.
- **🏎️ Non-Blocking Streamed CSV Export (Part 3.3)**: Chunked pagination with `setImmediate` event loop yielding to export 10,000+ candidate records without stalling incoming HTTP traffic.
- **✉️ Asynchronous Fire-and-Forget Notifications (Part 3.4)**: Candidate application triggers a simulated confirmation email with exponential backoff retries and durable error logging without blocking the `HTTP 201 Created` client response.
- **🏁 Optimistic Concurrency Control (Part 3.5)**: Employs a database `version` column to prevent lost updates when multiple recruiters simultaneously modify the same applicant, returning `HTTP 409 Conflict` on version mismatch.
- **🔍 Hand-Written Debounce Closure & Cancellation (Part 3.6)**: Custom closure in the frontend with `AbortController` cancellation to prevent stale in-flight search responses from overwriting fresh results.
- **🔄 Optimistic UI Updates & Automatic Rollback**: TanStack Query mutations update the recruiter table immediately; if the server rejects a transition, the UI rolls back to the prior cache snapshot.

---

## 🚀 Quickstart: Clean Clone & Run Guide

Follow these steps to run the complete project locally from a fresh clone:

### 1. Prerequisites

- **Node.js**: `v20.x` or higher
- **Package Managers**: `npm` and `pnpm` (`npm install -g pnpm`)
- **Git**

---

### 2. Clone Repository

```bash
git clone https://github.com/Glitchier/ninja-hire-assignment.git
cd ninja-hire-assignment
```

---

### 3. Backend Setup

1. **Install dependencies**:

   ```bash
   cd backend
   npm install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

   Fill in your Supabase project keys in `backend/.env`:

   ```env
   PORT=4000
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_DB_PASSWORD=your_db_password
   SUPABASE_PUBLIC_KEY=your_supabase_anon_key
   SUPABASE_SECRET_KEY=your_supabase_service_role_key
   FRONTEND_ORIGIN=http://localhost:3000
   ```

   > 🚨 **Security Rule**: The `SUPABASE_SECRET_KEY` (`service_role` key) must **NEVER** be committed to GitHub or exposed to client-side frontend code. Keep it strictly inside `backend/.env` (which is in `.gitignore`).

3. **Apply Database Migrations**:
   The database schema, RLS policies, trigger functions, and private storage bucket definition live in:
   [`supabase/supabase/migrations/20261111101848_create_profiles.sql`](file:///e:/Projects/ninja-hire-assignment/supabase/supabase/migrations/20261111101848_create_profiles.sql).

   You can apply it via the Supabase CLI or by pasting the file contents directly into your **Supabase Dashboard ➔ SQL Editor** and clicking **Run**.

4. **Seed Database with Sample Data**:
   Populates 3 Recruiters, 10 Candidates, 10 Jobs, and 50+ sample applications:

   ```bash
   npm run seed
   ```

5. **Start the Backend Server**:
   ```bash
   npm run dev
   ```
   Backend will start at: `http://localhost:4000` (Health check at `http://localhost:4000/health`).

---

### 4. Frontend Setup

1. **Open a new terminal window** and navigate to `frontend`:

   ```bash
   cd frontend
   pnpm install
   ```

2. **Configure Environment Variables**:
   Create a `.env.local` file inside `frontend/`:

   ```bash
   # frontend/.env.local
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   NEXT_PUBLIC_API_URL=http://localhost:4000
   ```

3. **Start the Next.js Development Server**:
   ```bash
   pnpm dev
   ```
   Open your browser to: **`http://localhost:3000`** (automatically redirects to `/jobs`).

---

## 🔑 Pre-Seeded Test Credentials

Use these pre-seeded accounts to test recruiter and candidate permissions:

| Role            | Email                     | Password       | What You Can Test                                                                        |
| :-------------- | :------------------------ | :------------- | :--------------------------------------------------------------------------------------- |
| **Recruiter A** | `recruiter1@techcorp.com` | `Password123!` | View own jobs, manage stages with optimistic updates, bulk stage updates, export CSV     |
| **Recruiter B** | `recruiter2@startup.io`   | `Password123!` | Verifying Recruiter B is blocked from reading Recruiter A's applicants (`403 Forbidden`) |
| **Candidate**   | `candidate1@example.com`  | `Password123!` | Apply to jobs with resume upload (PDF/DOCX), duplicate protection (`409 Conflict`)       |

---

## 🧪 Running the Test Suite

The test suite covers authorization checks, state machine transitions, duplicate application prevention, concurrency limiting, and race condition reproduction.

From the `backend` directory:

```bash
npm test
```

### Test Coverage Summary:

- ✅ `GET /health` returns 200 and healthy status.
- ✅ `GET /jobs` parses and validates query parameters.
- ✅ `POST /jobs` unauthenticated requests return `HTTP 401`.
- ✅ `GET /jobs/:id/applications` verifies Recruiter B cannot read Recruiter A's applicants (`HTTP 403 Forbidden`).
- ✅ `PATCH /applications/:id` rejects illegal stage transitions (`applied ➔ offer`) with `HTTP 400`.
- ✅ `PATCH /applications/:id` rejects moving an already `rejected` application with `HTTP 400`.
- ✅ `POST /jobs/:id/applications` rejects duplicate applications from the same candidate with `HTTP 409 Conflict`.
- ✅ `mapConcurrent` strictly caps in-flight operations at 5 and preserves original order.
- ✅ `mapConcurrent` handles individual task failures without aborting remaining tasks.
- ✅ `race-condition.test.ts` (passing test): Verifies optimistic locking detects concurrent modifications and returns `HTTP 409 Conflict`.

---

## 🏎️ Running Event Loop Load Benchmark (Part 3.3)

To reproduce and measure the event loop blockage between naive in-memory CSV export vs streamed export:

1. In Terminal 1, ensure the backend is running (`npm run dev`).
2. In Terminal 2, run `autocannon` targeting the health check endpoint:
   ```bash
   npx autocannon -c 10 -d 5 http://localhost:4000/health
   ```
3. Trigger the naive export endpoint (`GET /jobs/:id/export-naive` with 10k rows) and notice the latency spike to **> 1,400 ms** because the single Node.js thread is blocked.
4. Trigger the streamed export endpoint (`GET /jobs/:id/export`) and notice health check latency remains at **~16 ms** with zero dropped requests.

---

## 📚 In-Depth Project Documentation

Detailed architecture specifications, scalability analyses, and async walkthroughs can be found in:

- **[`ASYNC.md`](file:///e:/Projects/ninja-hire-assignment/ASYNC.md)**: Comprehensive documentation answering Part 3 (file & line numbers, unhandled rejection behavior, connection pool exhaustion analysis, debounce closures).
- **[`DESIGN.md`](file:///e:/Projects/ninja-hire-assignment/DESIGN.md)**: Database schema justification, index benchmarks, 100x scale analysis (50k jobs, 5M apps), and queue-based email designs.
  |
