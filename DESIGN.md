# DESIGN.md

This document covers the system design, database choices, scalability plans, and tradeoffs for the Mini Applicant Tracker.

---

## 1. Schema Design and Indexes

### The Three Tables

```
+-------------------------------------------------------------+
|                        DATA MODEL                           |
+-------------------------------------------------------------+
|                                                             |
|   profiles                                                  |
|   - id (UUID, links to auth.users)                          |
|   - email (TEXT)                                            |
|   - full_name (TEXT)                                        |
|   - role ('recruiter' | 'candidate')                        |
|                                                             |
|   jobs                                                      |
|   - id (UUID, primary key)                                  |
|   - recruiter_id (UUID, links to profiles)                  |
|   - title (TEXT)                                            |
|   - description (TEXT)                                      |
|   - location (TEXT)                                         |
|   - status ('open' | 'closed' | 'draft')                    |
|                                                             |
|   applications                                              |
|   - id (UUID, primary key)                                  |
|   - job_id (UUID, links to jobs)                            |
|   - candidate_id (UUID, links to profiles)                  |
|   - stage ('applied' | 'screening' | 'interview' |          |
|            'offer'   | 'rejected')                          |
|   - resume_url (TEXT, path in private storage)              |
|   - version (INTEGER, for optimistic locking)               |
|                                                             |
|   CONSTRAINT: UNIQUE(job_id, candidate_id)                  |
|   (Stops candidates from applying to the same job twice)    |
|                                                             |
+-------------------------------------------------------------+
```

### Why we added each index
We didn't add random indexes; each one connects directly to an API endpoint query:

1. **`jobs(status)`**: Used by `GET /jobs?status=open`. Lets Postgres jump straight to open jobs without scanning closed or draft jobs.
2. **`jobs(created_at DESC)`**: Used by `GET /jobs` pagination. Returns jobs in newest-first order without having to sort in memory.
3. **`jobs(recruiter_id)`**: Used by `GET /jobs/:id/applications` to quickly check if the logged-in recruiter owns the job.
4. **`jobs(title)` (GIN full-text search)**: Used by `GET /jobs?search=...`. Fast keyword searching on job titles without slow `LIKE '%...%'` full-table scans.
5. **`applications(job_id, stage)`**: Composite index used by `GET /jobs/:id/applications?stage=screening`. Filters by both job ID and stage in one fast index lookup.

---

## 2. What Breaks at 100x Scale? (50,000 Jobs, 5,000,000 Applications)

### What breaks first: Counting applicants
- **The problem**: `GET /jobs/:id` runs `SELECT count(*) FROM applications WHERE job_id = $id`. When a single popular job has 50,000 applicants, Postgres has to count all 50,000 entries one by one. This causes high disk reads and slows the endpoint down to 500ms+.
- **How I'd know**: Check `pg_stat_statements` for queries with high average runtimes, and monitor database CPU usage.
- **The fix**: Add an `application_count INTEGER DEFAULT 0` column directly onto the `jobs` table. Increment it with a simple Postgres trigger whenever a new application is added. Reading the count becomes an instant $O(1)$ read.

### What breaks second: Searching and filtering the job list
- **The problem**: Candidates hitting `GET /jobs?status=open&page=1` over and over will put unnecessary load on the database.
- **How I'd know**: P99 response times on `GET /jobs` rising during peak hours.
- **The fix**: Put Redis in front of the database. Cache the first page of jobs for common filter combos (like `status=open`) with a **60-second TTL**. Invalidate the cache whenever a recruiter creates or edits a job.

### What breaks third: Deep pagination
- **The problem**: Using `OFFSET 20000 LIMIT 10` forces Postgres to read through 20,000 rows just to throw them away and give you the next 10.
- **The fix**: Switch to cursor-based pagination:  
  `WHERE created_at < $last_seen_timestamp ORDER BY created_at DESC LIMIT 10`.

---

## 3. Resume Uploads at Scale

### What is wrong with our current approach?
Right now, the file binary travels from the user's browser $\rightarrow$ our Express server $\rightarrow$ Supabase storage. 

If 200 candidates upload a 5MB resume at the exact same moment:
1. Our Express server has to hold roughly 1GB of file data in memory at once.
2. The server's network bandwidth gets split between receiving files and re-uploading them.
3. Mobile users with slow connections keep server connections busy for minutes.

### The scalable solution: Pre-signed upload URLs
1. Candidate's browser asks the backend: *"Give me an upload ticket for job #123"*.
2. Backend generates a temporary, signed upload URL from Supabase / S3 (valid for 60 seconds) and gives it back.
3. Browser uploads the PDF **directly to Supabase Storage**.
4. Once the upload finishes, the browser tells the backend: *"Uploaded! Here is the file path"*.
5. **Result**: Zero file bytes pass through our backend server. It scales effortlessly.

---

## 4. Connection Pooling

### Why it matters
Connecting to Postgres is expensive. Each new connection requires a network handshake, SSL setup, and creates a separate process on the database server (~10MB RAM per connection).

### What happens without a pool under load?
If 1,000 users hit our API at the same second and each request opens a raw connection to Postgres:
1. Postgres hits its connection limit (usually 100 on free/small plans).
2. Postgres rejects new requests with: `sorry, too many clients already`.
3. The API starts throwing 500 errors to users.

### The solution: Connection Pooling (PgBouncer)
Instead of opening a new connection per request, Express talks to a pooler like **PgBouncer** in transaction mode. PgBouncer keeps a small pool of 20 open connections to Postgres and shares them between thousands of incoming web requests. Each request uses a connection for a few milliseconds, runs its query, and gives it back.

---

## 5. The Confirmation Email, Done Properly

In Part 3.4, we used an in-memory retry function. In a real company, this is risky because if the server restarts or crashes while retrying, the pending email is lost forever.

### The Real Architecture: A Message Queue

```
[User Applies]
       |
       v
[Express API]  ---> Saves application to Postgres
       |
       v
Pushes job into Redis (BullMQ)
       |
       v
[Worker Process] pulls job from queue
       |
       +---> Calls SendGrid / Resend API
       |
  (If it fails 3 times)
       |
       v
[Dead Letter Queue (DLQ)] ---> Alerts the team in Slack / Sentry
```

### What we gain
- **Reliability**: If the server restarts, the email jobs are safely stored in Redis and continue when it comes back up.
- **Rate limiting**: We can throttle the workers to never send more than 10 emails/second, avoiding provider rate limits.
- **DLQ**: Failed emails don't disappear; they sit in a dead-letter queue so we can inspect and replay them.

### New problems this introduces
- **Duplicate emails**: In distributed queues, a worker might send the email, but crash right before telling Redis it finished. Another worker will pick up the task and send it again.  
  *Fix*: Store an idempotency key in Redis (e.g., `email:sent:${application_id}`) for 24 hours. If it's already there, skip sending.
- **Queue downtime**: If Redis goes down, we can't accept jobs.  
  *Fix*: Use an outbox table in Postgres within the same transaction as the application, and have a background process read from it.

---

## 6. Three Tradeoffs Under Time Pressure

1. **In-Memory Concurrency Limiter instead of Redis Queue**:
   - *What we did*: Capped concurrency at 5 inside Node.js memory (`mapConcurrent`).
   - *The tradeoff*: Works great on a single server, but if we deploy 4 server instances, each has its own limiter of 5 (total of 20 queries).
   - *With another week*: Use BullMQ with Redis so the concurrency cap of 5 is shared across all servers.

2. **Passing Uploads Through Server instead of Signed URLs**:
   - *What we did*: Handled resume uploads through Express using `busboy`.
   - *The tradeoff*: Slower and uses server RAM, but let us complete Part 3.1's callback-wrapping requirement cleanly.
   - *With another week*: Generate pre-signed upload URLs from Supabase Storage so files go directly to the cloud bucket.

3. **Client Polling instead of Supabase Realtime**:
   - *What we did*: The recruiter's dashboard fetches updates on page load and after actions.
   - *The tradeoff*: If Recruiter A changes an applicant's stage, Recruiter B doesn't see it until they refresh or take an action.
   - *With another week*: Hook up Supabase Realtime WebSockets so applicants move across columns live on everyone's screen.
