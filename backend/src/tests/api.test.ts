import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { mapConcurrent } from "../utils/concurrencyLimiter.js";
import { supabaseAdmin } from "../config/supabase.js";

describe("ATS Backend Test Suite", () => {
  // 1. HEALTH CHECK TEST
  it("GET /health returns 200 and healthy status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 2. QUERY PARAMS & VALIDATION TEST
  it("GET /jobs parses query parameters without getter mutation error", async () => {
    const res = await request(app).get("/jobs?page=1&limit=5&status=open");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // 3. UNLOGGED IN / REJECTED AUTH TEST (401 Unauthorized)
  it("POST /jobs rejects unauthenticated requests with HTTP 401", async () => {
    const res = await request(app)
      .post("/jobs")
      .send({
        title: "Unauthorized Job",
        description: "Should fail with 401 unauthenticated",
        location: "Remote",
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Authentication required|Bearer/i);
  });

  // 4. AUTHORIZATION CHECK: Recruiter A vs Recruiter B (HTTP 403 Forbidden)
  it("GET /jobs/:id/applications enforces authorization: Recruiter B cannot read Recruiter A's applicants", async () => {
    // Mock authenticated user as Recruiter B
    vi.spyOn(supabaseAdmin.auth, "getUser").mockResolvedValueOnce({
      data: { user: { id: "recruiter-b-uuid", email: "recruiterB@example.com" } } as any,
      error: null,
    });

    vi.spyOn(supabaseAdmin, "from").mockImplementation((table: string): any => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: "recruiter-b-uuid", role: "recruiter", full_name: "Recruiter B", email: "recruiterB@example.com" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "jobs") {
        return {
          select: () => ({
            eq: () => ({
              // This job belongs to Recruiter A!
              single: () => Promise.resolve({
                data: { id: "job-1-uuid", recruiter_id: "recruiter-a-uuid" },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });

    const res = await request(app)
      .get("/jobs/job-1-uuid/applications")
      .set("Authorization", "Bearer mock-token-recruiter-b");

    // Recruiter B must be blocked with HTTP 403 Forbidden!
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Forbidden|not authorized/i);

    vi.restoreAllMocks();
  });

  // 5. STAGE TRANSITION VALIDATION: Rejects illegal stage jumps with 400
  it("PATCH /applications/:id rejects illegal stage jump (applied -> offer) with HTTP 400", async () => {
    vi.spyOn(supabaseAdmin.auth, "getUser").mockResolvedValueOnce({
      data: { user: { id: "recruiter-a-uuid", email: "recruiterA@example.com" } } as any,
      error: null,
    });

    vi.spyOn(supabaseAdmin, "from").mockImplementation((table: string): any => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: "recruiter-a-uuid", role: "recruiter", full_name: "Recruiter A", email: "recruiterA@example.com" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "applications") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: {
                  id: "app-123",
                  stage: "applied", // Current stage is applied
                  version: 1,
                  job_id: "job-1-uuid",
                  jobs: { recruiter_id: "recruiter-a-uuid" },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    // Attempting illegal jump: applied -> offer
    const res = await request(app)
      .patch("/applications/app-123")
      .set("Authorization", "Bearer mock-token-recruiter-a")
      .send({ stage: "offer" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Invalid transition.*screening/i);

    vi.restoreAllMocks();
  });

  // 6. STAGE TRANSITION VALIDATION: Rejects moving an already rejected application with 400
  it("PATCH /applications/:id rejects moving a rejected application with HTTP 400", async () => {
    vi.spyOn(supabaseAdmin.auth, "getUser").mockResolvedValueOnce({
      data: { user: { id: "recruiter-a-uuid", email: "recruiterA@example.com" } } as any,
      error: null,
    });

    vi.spyOn(supabaseAdmin, "from").mockImplementation((table: string): any => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: "recruiter-a-uuid", role: "recruiter", full_name: "Recruiter A", email: "recruiterA@example.com" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "applications") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: {
                  id: "app-rejected",
                  stage: "rejected", // Already rejected!
                  version: 2,
                  job_id: "job-1-uuid",
                  jobs: { recruiter_id: "recruiter-a-uuid" },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await request(app)
      .patch("/applications/app-rejected")
      .set("Authorization", "Bearer mock-token-recruiter-a")
      .send({ stage: "interview" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/rejected application cannot be moved/i);

    vi.restoreAllMocks();
  });

  // 7. DUPLICATE PROTECTION: Unique DB Constraint triggers HTTP 409 Conflict
  it("Duplicate application triggers HTTP 409 Conflict via DB constraint handler", async () => {
    vi.spyOn(supabaseAdmin.auth, "getUser").mockResolvedValueOnce({
      data: { user: { id: "candidate-1-uuid", email: "candidate@example.com" } } as any,
      error: null,
    });

    vi.spyOn(supabaseAdmin, "from").mockImplementation((table: string): any => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: "candidate-1-uuid", role: "candidate", full_name: "Candidate One", email: "candidate@example.com" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "jobs") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: "job-1-uuid", status: "open" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "applications") {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.reject({
                code: "23505", // PostgreSQL Unique Violation
                message: 'duplicate key value violates unique constraint "unique_candidate_per_job"',
              }),
            }),
          }),
        };
      }
      return {};
    });

    // Mock storage upload
    vi.spyOn(supabaseAdmin.storage, "from").mockReturnValue({
      upload: () => Promise.resolve({ error: null }),
    } as any);

    const res = await request(app)
      .post("/jobs/job-1-uuid/applications")
      .set("Authorization", "Bearer mock-token-candidate")
      .attach("resume", Buffer.from("%PDF-1.4 sample content"), "resume.pdf");

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Conflict|already submitted/i);

    vi.restoreAllMocks();
  });

  // 8. CONCURRENCY LIMITER TEST (Part 3.2)
  it("mapConcurrent caps in-flight tasks at 5 and preserves order", async () => {
    const totalTasks = 20;
    const taskIds = Array.from({ length: totalTasks }, (_, i) => i);
    let activeWorkers = 0;
    let maxObservedActive = 0;

    const results = await mapConcurrent(taskIds, 5, async (id) => {
      activeWorkers++;
      maxObservedActive = Math.max(maxObservedActive, activeWorkers);

      // Simulate async database query latency
      await new Promise((resolve) => setTimeout(resolve, 30));

      activeWorkers--;
      return `result-${id}`;
    });

    // Concurrency strictly capped at 5
    expect(maxObservedActive).toBeLessThanOrEqual(5);

    // Results in exact order
    expect(results.length).toBe(totalTasks);
    for (let i = 0; i < totalTasks; i++) {
      expect(results[i]?.status).toBe("fulfilled");
      expect(results[i]?.value).toBe(`result-${i}`);
    }
  });

  // 9. CONCURRENCY LIMITER FAULT TOLERANCE (Promise.allSettled)
  it("mapConcurrent does not abort remaining tasks if one fails", async () => {
    const items = [1, 2, 3, 4, 5];

    const results = await mapConcurrent(items, 2, async (num) => {
      if (num === 3) {
        throw new Error("Item 3 simulated database failure");
      }
      return num * 10;
    });

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[0]?.value).toBe(10);

    expect(results[2]?.status).toBe("rejected");
    expect(results[2]?.reason?.message).toContain("Item 3");

    expect(results[4]?.status).toBe("fulfilled");
    expect(results[4]?.value).toBe(50);
  });
});
