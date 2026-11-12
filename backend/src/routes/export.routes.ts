import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const router = Router();

/**
 * NAIVE VERSION: Fetch all into memory, build big string.
 * Demonstrates event loop blockage!
 */
router.get(
  "/:id/export-naive",
  requireAuth,
  requireRole("recruiter"),
  async (req, res, next) => {
    try {
      const { id: jobId } = req.params;

      // 1. Fetch ALL rows at once into RAM
      const { data: rows, error } = await supabaseAdmin
        .from("applications")
        .select(
          "id, candidate_id, stage, created_at, profiles!candidate_id(full_name, email)",
        )
        .eq("job_id", jobId);

      if (error) throw error;

      // 2. Synchronous CPU-intensive loop (Blocks Event Loop!)
      let csv =
        "Application ID,Candidate Name,Candidate Email,Stage,Created At\n";
      for (let i = 0; i < (rows || []).length; i++) {
        const row = rows[i]!;
        const profile = row.profiles as any;
        csv += `"${row.id}","${profile?.full_name || ""}","${profile?.email || ""}","${row.stage}","${row.created_at}"\n`;
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="job-${jobId}-naive.csv"`,
      );
      return res.send(csv);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * FIXED VERSION: Streamed, paginated response!
 * Yields back to the event loop so other requests are served concurrently.
 */
router.get(
  "/:id/export",
  requireAuth,
  requireRole("recruiter"),
  async (req, res, next) => {
    try {
      const { id: jobId } = req.params;

      // Verify ownership
      const { data: job } = await supabaseAdmin
        .from("jobs")
        .select("recruiter_id")
        .eq("id", jobId)
        .single();
      if (!job || job.recruiter_id !== req.user!.id) {
        return res.status(403).json({ success: false, error: "Unauthorized" });
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="job-${jobId}-applications.csv"`,
      );

      // Write CSV header immediately
      res.write(
        "Application ID,Candidate Name,Candidate Email,Stage,Created At\n",
      );

      const batchSize = 1000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: batch, error } = await supabaseAdmin
          .from("applications")
          .select(
            "id, stage, created_at, profiles!candidate_id(full_name, email)",
          )
          .eq("job_id", jobId)
          .range(offset, offset + batchSize - 1);

        if (error) throw error;

        if (!batch || batch.length === 0) {
          hasMore = false;
          break;
        }

        // Format batch chunk
        let chunk = "";
        for (const row of batch) {
          const profile = row.profiles as any;
          chunk += `"${row.id}","${profile?.full_name || ""}","${profile?.email || ""}","${row.stage}","${row.created_at}"\n`;
        }

        // Stream chunk to client!
        res.write(chunk);

        if (batch.length < batchSize) {
          hasMore = false;
        } else {
          offset += batchSize;
          // Yield to event loop!
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      res.end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
