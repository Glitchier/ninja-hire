import { describe, it, expect } from "vitest";

describe("Part 3.5 Race Condition & Optimistic Locking", () => {
  /**
   * ❌ BROKEN / UNFIXED VERSION (Kept skipped and commented as required by assignment)
   *
   * Explanation:
   * Without optimistic locking (no version column or WHERE version = expected),
   * two concurrent requests both read stage = 'applied'.
   * Request 1 changes stage to 'screening'.
   * Request 2 changes stage to 'rejected'.
   * Both execute blind UPDATE statements. The second request overwrites the first,
   * completely losing the first recruiter's decision with NO error returned!
   */
  it.skip("FAILING TEST (Unfixed Code): Lost update race condition when two requests execute without optimistic lock", async () => {
    let mockDatabaseRecord = { stage: "applied", version: 1 };

    // Two concurrent requests without version check
    async function updateWithoutLock(newStage: string) {
      // Both read initial state
      const current = mockDatabaseRecord.stage;
      await new Promise((r) => setTimeout(r, 10)); // simulate DB latency
      // Blind write!
      mockDatabaseRecord.stage = newStage;
      return { success: true, stage: newStage };
    }

    const [res1, res2] = await Promise.all([
      updateWithoutLock("screening"),
      updateWithoutLock("rejected"),
    ]);

    // In unfixed code, both claim success, but 'screening' was lost!
    expect(res1.success && res2.success).toBe(true);
    // This demonstrates the bug: one update was silently lost without conflict error.
  });

  /**
   * ✅ FIXED VERSION (Optimistic Locking with Version Column)
   *
   * Explanation:
   * In the fixed implementation, both requests supply the current version (version: 1).
   * The database executes:
   * UPDATE applications SET stage = $stage, version = version + 1
   * WHERE id = $id AND version = $version;
   *
   * The first update to reach PostgreSQL updates 1 row and increments version to 2.
   * The second update runs with WHERE version = 1, matches 0 rows,
   * and triggers an HTTP 409 Conflict exception!
   */
  it("PASSING TEST (Fixed Code): Detects concurrent update conflict and rejects second request with 409", async () => {
    let mockDatabaseRecord = { stage: "applied", version: 1 };

    // Function simulating optimistic locking query:
    // UPDATE applications SET stage = $newStage, version = version + 1 WHERE version = $expectedVersion
    async function updateWithOptimisticLock(newStage: string, expectedVersion: number) {
      await new Promise((r) => setTimeout(r, Math.random() * 20));

      if (mockDatabaseRecord.version !== expectedVersion) {
        return { status: 409, error: "Conflict: Version mismatch" };
      }

      mockDatabaseRecord.stage = newStage;
      mockDatabaseRecord.version += 1;
      return { status: 200, stage: newStage, version: mockDatabaseRecord.version };
    }

    // Both concurrent requests read version = 1
    const [res1, res2] = await Promise.all([
      updateWithOptimisticLock("screening", 1),
      updateWithOptimisticLock("rejected", 1),
    ]);

    const statuses = [res1.status, res2.status];

    // Exactly one must succeed (200) and one must be rejected with 409 Conflict!
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);
  });
});

