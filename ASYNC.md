# ASYNC.md

This document explains the 6 async requirements from Part 3: where they live in the code, why they are needed, and how they were tested.

---

## 3.1 — Wrapping a Callback API (Resume Upload)

- **File**: `backend/src/utils/fileUpload.ts` (lines 16–70)
- **Used in**: `backend/src/routes/jobs.routes.ts` (POST `/jobs/:id/applications`)

### What it does
File upload libraries like `busboy` use Node.js streams and event callbacks (`file`, `data`, `error`, `close`). We wrapped these callbacks into a normal JavaScript `Promise` by hand, without using `util.promisify` or any helper package.

### What happens if you don't wire the error path?
If you only listen for success (`bb.on('close')`) and forget to listen for errors (`fileStream.on('error')` and `bb.on('error')`), any error—like the user canceling the upload halfway through or uploading bad data—causes the callback to silently fail. 

Because `reject()` is never called, the `Promise` stays in a "pending" state forever. The backend never sends an HTTP response back, the connection stays open, and the user's browser just spins until it times out after a minute.

### The version that handles it
We explicitly listen for errors on both the file stream and the parser:

```typescript
// Listen for stream errors
fileStream.on("error", (err) => {
  reject(err);
});

// Listen for parser errors
bb.on("error", (err) => {
  reject(err);
});

// Also handle files larger than 5MB cleanly
fileStream.on("limit", () => {
  sizeExceeded = true;
  fileStream.resume(); // drain stream so it doesn't hang
});
```

### How I verified it works
I sent a POST request with broken multipart data and a file over 5MB. The server immediately sent back a `400 Bad Request` error instead of hanging.

---

## 3.2 — Concurrency Limit (Bulk Stage Change)

- **File**: `backend/src/utils/concurrencyLimiter.ts` (lines 15–48)
- **Used in**: `backend/src/routes/jobs.routes.ts` (POST `/jobs/:id/applications/bulk-stage`)

### What it does
When a recruiter selects up to 50 applicants to update at once, we don't run all 50 updates at the exact same millisecond. We cap the active work to a maximum of **5 requests in flight** at any time. We wrote this queue by hand with a simple worker loop—no `p-limit` or external libraries.

### Why Promise.allSettled instead of Promise.all?
If you have 50 updates and one of them fails (for example, applicant #3 was already rejected), `Promise.all` immediately crashes and throws away the results of all the other 49 updates. You wouldn't know which ones worked and which ones failed.

With `Promise.allSettled`, every single item is attempted. If applicant #3 fails, it records the failure, but keeps going and updates the rest. The API returns a neat summary showing exactly which succeeded and which failed:

```json
{
  "summary": { "total": 50, "succeeded": 48, "failed": 2 },
  "results": [
    { "id": "1", "success": true, "stage": "screening" },
    { "id": "2", "success": false, "error": "Cannot move a rejected application" }
  ]
}
```

### What would happen to Supabase connection pool at 500 rows without the limiter?
Supabase free tier gives you a small database connection pool (around 15 to 20 direct connections). If a recruiter updates 500 rows at once without a limiter, Node fires 500 database queries simultaneously. 

Postgres immediately runs out of connection slots and throws `FATAL: sorry, too many clients already`. When that happens, the database drops incoming connections, and the entire app (logins, job viewing, applies) crashes with 500 errors.

### How I verified it works
In `backend/src/tests/api.test.ts`, I created a test with 20 tasks running through `mapConcurrent(tasks, 5)`. The test tracks active workers and proves that concurrency never goes above 5, and the results come back in the exact same order as the input array.

---

## 3.3 — Not Blocking the Event Loop (CSV Export)

- **File**: `backend/src/routes/export.routes.ts`
  - Naive version: `GET /jobs/:id/export-naive`
  - Fixed version: `GET /jobs/:id/export`

### The Problem
Node.js runs your JavaScript code on a single thread. In the naive version, when exporting 10,000 rows, it fetched all rows into RAM and ran a big synchronous `for` loop to build one giant CSV string. While that loop is running, the CPU is 100% busy—Node cannot handle ANY other requests (even a simple `/health` check has to wait).

### The Real Measurements (tested with autocannon)
While running each export on 10,000 rows, I ran `autocannon` against `/health`:

| Version | What it does | Health check response time during export | Did it block? |
| :--- | :--- | :---: | :---: |
| **Naive version** (`/export-naive`) | Builds giant string in memory with a synchronous loop | **~1,450 ms** | **YES** (Server froze for 1.4 seconds) |
| **Fixed version** (`/export`) | Streams in chunks of 1,000 with `setImmediate` | **~16 ms** | **NO** (Server stayed fast and responsive) |

### Why the naive version blocked
Because of Node's single-threaded event loop. If the thread is stuck executing a long `for` loop, it cannot leave to check incoming network events. It can only answer waiting requests *after* the loop is finished.

### How the fix works
1. We write the CSV headers immediately (`res.write(...)`).
2. We fetch from the database in batches of 1,000 using `.range(offset, offset + 999)`.
3. After each batch, we call `await new Promise((r) => setImmediate(r));`. This tells Node: *"Pause here for a millisecond, handle any waiting network requests, and then come back to finish the next chunk."*

---

## 3.4 — Fire-and-Forget vs. Awaiting (Confirmation Email)

- **File**: `backend/src/utils/emailService.ts`
- **Used in**: `backend/src/routes/jobs.routes.ts` (POST `/jobs/:id/applications`)

### What it does
When someone applies for a job, sending an email takes 2 seconds and fails 30% of the time. We do NOT use `await sendEmail()`. Instead, we trigger it in the background ("fire-and-forget"). The candidate gets their `201 Created` response right away (< 150ms).

### What an unhandled promise rejection does to Node
In modern Node.js, if a background promise fails and you didn't attach a `.catch()`, Node emits an `unhandledRejection` event and **crashes the entire Node server process**. One failed email would take down the whole app for all users.

### Why an empty `catch {}` is worse than not catching
If you just write `.catch(() => {})`, you hide the crash, but the error vanishes into thin air. If emails start failing completely, nobody knows. No logs exist, no alerts fire, and candidates never get their confirmations.

### How we handle it
We use a retry function with exponential backoff (retries up to 3 times, waiting 1s, then 2s, then 4s). If all retries fail, it writes an error log to the console with the candidate's email so the failure is recorded.

---

## 3.5 — Race Condition (Concurrent Stage Change)

- **File**: `backend/src/routes/applications.routes.ts`
- **Test File**: `backend/src/tests/race-condition.test.ts`

### The Problem
If Recruiter 1 and Recruiter 2 both open the same applicant at the same time:
- Recruiter 1 changes stage from `applied` to `screening`.
- Recruiter 2 changes stage from `applied` to `rejected`.

Without protection, both requests hit the database, and whoever saves last overwrites the other person's decision. One recruiter's action is quietly lost without warning.

### The Fix: Optimistic Locking with a `version` column
We added an integer `version` column to the `applications` table (starts at 1).

When an update runs, it checks:
```sql
UPDATE applications
SET stage = $newStage, version = version + 1
WHERE id = $id AND version = $expectedVersion;
```

1. Recruiter 1's request runs first: version matches `1`. It updates the row and sets `version` to `2`.
2. Recruiter 2's request runs next: it looks for `version = 1`. But the row is now `version = 2`!
3. Postgres updates 0 rows.
4. The backend sees 0 rows updated and returns `409 Conflict: This application was modified by someone else. Please refresh.`

### How I verified it works
In `backend/src/tests/race-condition.test.ts`:
- **Skipped test**: Demonstrates the unfixed bug where both requests succeed and one update is lost.
- **Passing test**: Fires two requests at the same time using `Promise.all`. Exactly one gets `200 OK` and the other gets `409 Conflict`.

---

## 3.6 — Closures in the Frontend (Debounced Search)

- **File**: `frontend/lib/debounce.ts`
- **Used in**: `frontend/app/jobs/page.tsx`

### What state the closure holds
The debounce function holds a single variable in its closure: `timerId`.

```typescript
export function debounce(func, waitMs) {
  let timerId = null; // Stored in the closure!

  return function (...args) {
    if (timerId !== null) clearTimeout(timerId); // cancel previous countdown
    timerId = setTimeout(() => {
      func(...args);
    }, waitMs);
  };
}
```

### Why recreating it on every render breaks it
In React, when a user types, state changes and the component re-renders. If `debounce` is created directly inside the component without `useMemo`, a brand new `debounce` function with a brand new `timerId = null` is created on every single keystroke. 

The previous timer is never cleared. If you type 6 letters quickly, 6 separate API requests will fire 300ms later. Wrapping it in `useMemo` keeps the same function and the same timer across renders.

### Handling stale responses (Network Race Condition)
What if a user types "React" (Request A, slow network, takes 1 second), and then quickly types "Node" (Request B, fast network, takes 200ms)?
- Request B finishes first: screen shows Node jobs.
- Then Request A finishes late: screen gets overwritten with React jobs! Even though the input says "Node"!

**The fix**: We use an `AbortController` (handled automatically via TanStack Query's `signal`). When a new search is sent, any older in-flight request is immediately aborted so stale data can never overwrite fresh results.
