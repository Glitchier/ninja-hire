import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createJobSchema,
  getJobsQuerySchema,
  getApplicationsQuerySchema,
} from "../schemas/job.schema.js";
import { supabaseAdmin } from "../config/supabase.js";
import { parseMultipartUpload } from "../utils/fileUpload.js";
import { triggerConfirmationEmail } from "../utils/emailService.js";
import { mapConcurrent } from "../utils/concurrencyLimiter.js";
import { z } from "zod";

const router = Router();

/**
 * POST /jobs
 * Recruiter only — Creates a new job posting
 */
router.post(
  "/",
  requireAuth,
  requireRole("recruiter"),
  validate(createJobSchema, "body"),
  async (req, res, next) => {
    try {
      const { title, description, location, status } = req.body;

      const { data: job, error } = await supabaseAdmin
        .from("jobs")
        .insert({
          recruiter_id: req.user!.id,
          title,
          description,
          location,
          status,
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({
        success: true,
        data: job,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /jobs
 * Public / Authenticated — Paginated, filter by status, full-text search on title
 */
router.get(
  "/",
  validate(getJobsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, status, search, recruiter_id } = req.query as any;
      const offset = (page - 1) * limit;

      let query = supabaseAdmin
        .from("jobs")
        .select("*, profiles!recruiter_id(full_name, email)", {
          count: "exact",
        });

      // Filter by recruiter if provided
      if (recruiter_id) {
        query = query.eq("recruiter_id", recruiter_id);
      }

      // Filter by status if provided
      if (status && status !== "all") {
        query = query.eq("status", status);
      } else if (!status) {
        // By default, public users only see 'open' jobs
        query = query.eq("status", "open");
      }

      // Search on title using ILIKE
      if (search) {
        query = query.ilike("title", `%${search}%`);
      }

      // Paginate in the database (never in JavaScript memory!)
      query = query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: jobs, count, error } = await query;
      if (error) throw error;

      return res.json({
        success: true,
        data: jobs,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /jobs/:id
 * Includes application count
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Fetch job info
    const { data: job, error: jobError } = await supabaseAdmin
      .from("jobs")
      .select("*, profiles!recruiter_id(full_name, email)")
      .eq("id", id)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }

    // 2. Fetch application count
    const { count, error: countError } = await supabaseAdmin
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("job_id", id);

    if (countError) throw countError;

    return res.json({
      success: true,
      data: {
        ...job,
        application_count: count || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobs/:id/applications
 * 🚨 CRITICAL AUTHORIZATION CHECK: Recruiter A must not read Recruiter B's applications!
 */
router.get(
  "/:id/applications",
  requireAuth,
  requireRole("recruiter"),
  validate(getApplicationsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { id: jobId } = req.params;
      const { page, limit, stage } = req.query as any;
      const offset = (page - 1) * limit;

      // 1. Verify that this job exists AND belongs to the requesting recruiter!
      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs")
        .select("id, recruiter_id")
        .eq("id", jobId)
        .single();

      if (jobError || !job) {
        return res.status(404).json({ success: false, error: "Job not found" });
      }

      // 🚨 ENFORCE AUTHORIZATION HERE:
      if (job.recruiter_id !== req.user!.id) {
        return res.status(403).json({
          success: false,
          error:
            "Forbidden: You are not authorized to view applications for another recruiter's job.",
        });
      }

      // 2. Query applications for this job with candidate details
      let query = supabaseAdmin
        .from("applications")
        .select("*, profiles!candidate_id(full_name, email)", {
          count: "exact",
        })
        .eq("job_id", jobId);

      if (stage) {
        query = query.eq("stage", stage);
      }

      query = query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: applications, count, error: appsError } = await query;
      if (appsError) throw appsError;

      return res.json({
        success: true,
        data: applications,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /jobs/:id/applications
 * Candidate applies with resume upload (PDF/DOCX, <= 5MB)
 */
router.post(
  "/:id/applications",
  requireAuth,
  requireRole("candidate"),
  async (req, res, next) => {
    try {
      const { id: jobId } = req.params;
      const candidateId = req.user!.id;

      // 1. Verify Job exists and is open
      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs")
        .select("id, status")
        .eq("id", jobId)
        .single();

      if (jobError || !job) {
        return res.status(404).json({ success: false, error: "Job not found" });
      }
      if (job.status !== "open") {
        return res.status(400).json({
          success: false,
          error: "This job is closed for applications",
        });
      }

      // 2. Parse uploaded resume using our hand-wrapped Promise!
      const uploadedFile = await parseMultipartUpload(req, 5 * 1024 * 1024);

      // 3. Upload to Supabase Private Storage Bucket 'resumes'
      const storagePath = `${candidateId}/${Date.now()}-${uploadedFile.fileName}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from("resumes")
        .upload(storagePath, uploadedFile.fileBuffer, {
          contentType: uploadedFile.mimeType,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // 4. Insert application row into database
      // Note: If candidate already applied, unique_candidate_per_job constraint throws 23505 (handled by global error handler as 409)
      const { data: application, error: appError } = await supabaseAdmin
        .from("applications")
        .insert({
          job_id: jobId,
          candidate_id: candidateId,
          stage: "applied",
          resume_url: storagePath,
        })
        .select()
        .single();

      if (appError) throw appError;

      // 5. Part 3.4: Trigger Fire-and-Forget confirmation email! (DO NOT AWAIT!)
      triggerConfirmationEmail(req.user!.email, job.id);

      // Return 201 Created immediately without waiting for email!
      return res.status(201).json({
        success: true,
        message: "Application submitted successfully",
        data: application,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Bulk-stage Limit
const bulkStageSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(50),
  stage: z.enum(["applied", "screening", "interview", "offer", "rejected"]),
});

router.post(
  "/:id/applications/bulk-stage",
  requireAuth,
  requireRole("recruiter"),
  validate(bulkStageSchema, "body"),
  async (req, res, next) => {
    try {
      const { id: jobId } = req.params;
      const {
        applicationIds,
        stage: targetStage,
      }: z.infer<typeof bulkStageSchema> = req.body;

      // 1. Verify recruiter owns this job
      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs")
        .select("id, recruiter_id")
        .eq("id", jobId)
        .single();

      if (jobError || !job || job.recruiter_id !== req.user!.id) {
        return res
          .status(403)
          .json({ success: false, error: "Unauthorized access to job" });
      }

      // 2. Execute bulk updates with strict concurrency limit of 5!
      const results = await mapConcurrent(applicationIds, 5, async (appId) => {
        // Fetch current stage
        const { data: app, error } = await supabaseAdmin
          .from("applications")
          .select("id, stage, version")
          .eq("id", appId)
          .eq("job_id", jobId)
          .single();

        if (error || !app) {
          throw new Error("Application not found on this job");
        }

        // Validate state transitions
        if (app.stage === "rejected") {
          throw new Error("Cannot move a rejected application");
        }

        // Update database
        const { data: updated, error: updateError } = await supabaseAdmin
          .from("applications")
          .update({ stage: targetStage, version: app.version + 1 })
          .eq("id", appId)
          .eq("version", app.version)
          .select()
          .single();

        if (updateError || !updated) {
          throw new Error("Conflict or update failure");
        }

        return updated;
      });

      // Format response preserving original order
      const formattedResults = applicationIds.map((id: string, idx: number) => {
        const res = results[idx]!;
        if (res.status === "fulfilled") {
          return { id, success: true, stage: targetStage };
        } else {
          return { id, success: false, error: res.reason?.message || "Failed" };
        }
      });

      return res.json({
        success: true,
        summary: {
          total: applicationIds.length,
          succeeded: formattedResults.filter((r) => r.success).length,
          failed: formattedResults.filter((r) => !r.success).length,
        },
        results: formattedResults,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
