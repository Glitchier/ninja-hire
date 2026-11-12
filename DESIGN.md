# 🏛️ DESIGN.md — System Architecture & Scalability

## 1. Schema Design & Query-Justified Indexes

### Schema Overview:

-`profiles`: Mirrors Supabase `auth.users`, storing `role` ('recruiter' | 'candidate') and `full_name`. -`jobs`: Stores job listings scoped to `recruiter_id`. -`applications`: Links candidate to job with strict `stage` enum, `version` integer for optimistic locking, and a compound unique constraint:
`CONSTRAINT unique_candidate_per_job UNIQUE (job_id, candidate_id)`

### Indexes Justification:

1.`idx_jobs_recruiter_id ON jobs(recruiter_id)`: -_Query_: `SELECT * FROM jobs WHERE recruiter_id = $id` (recruiter dashboard). -_Why_: Avoids full table scans when checking recruiter ownership. 2.`idx_jobs_status ON jobs(status)`: -_Query_: `GET /jobs?status=open` -_Why_: Filters active job listings instantly. 3.`idx_applications_job_stage ON applications(job_id, stage)`: -_Query_: `GET /jobs/:id/applications?stage=screening` -_Why_: Composite B-tree index optimizes both the foreign key lookup and the stage filtering in a single index scan. 4.`idx_jobs_title_search ON jobs USING gin(to_tsvector('english', title))`: -_Query_: Full-text keyword search across job titles.

---

## 2. What Breaks at 100x Scale? (50,000 Jobs, 5,000,000 Applications)

### What Degrades First:

1.**Application Count Query (`GET /jobs/:id`)**: -`SELECT COUNT(*) FROM applications WHERE job_id = $id` becomes slow at millions of rows because Postgres performs sequential index scans. -_What to measure_: Database CPU utilization and query execution duration via `pg_stat_statements`. -_Solution_: Maintain a denormalized `application_count` column on the `jobs` table, updated via a database trigger on insert/delete. 2.**Jobs List Filtering (`GET /jobs`)**:
-High read traffic causes database connection spikes. -_Solution_: Cache job list page 1 per filter combo in Redis with a 60-second TTL, invalidated whenever a recruiter creates or edits a job.

---

## 3. Resume Uploads at Scale

-**Current Limitation**: File bytes pass through our Express server, consuming Node.js memory and worker bandwidth. -**Scalable Architecture**:
The client requests a **Pre-Signed Upload URL** from the backend (`GET /jobs/:id/upload-url`). The browser uploads the PDF directly to S3 / Supabase Storage via HTTP PUT. The backend never handles raw file bytes.

---

## 4. Connection Pooling

-**Why it matters**: Opening a new PostgreSQL connection per HTTP request requires a process fork, TCP handshake, and SSL negotiation (~50ms latency overhead). -**Under Load**: 1,000 concurrent requests would crash Postgres with out-of-memory errors. -**Solution**: Use PgBouncer in transaction pooling mode.

---

## 5. Queue-Based Email Architecture (Production 3.4)

-**Architecture**: Move asynchronous notifications to a persistent message queue (e.g. BullMQ / Redis or AWS SQS). -**Gains**: True fault tolerance, rate limiting against third-party email API limits, dead-letter queues (DLQ) for failed messages. -**New Failure Modes**: Queue broker downtime, duplicate message delivery requiring idempotency keys.

---

## 6. Three Tradeoffs Under Time Pressure

1.**In-Memory Buffering for Busboy Uploads**: -_Tradeoff_: Buffered files up to 5MB in RAM rather than piping directly to Supabase Storage. -_Future improvement_: Pipe incoming multipart stream directly to S3/Supabase. 2.**Polling vs WebSockets for Stage Updates**: -_Tradeoff_: Used REST polling rather than Supabase Realtime for stage updates. 3.**Application-Level Concurrency Limiter vs Distributed Redis Queue**: -_Tradeoff_: Implemented the concurrency limiter in Node.js process memory. -_Future improvement_: In a multi-replica cluster, use Redis-backed queues.
