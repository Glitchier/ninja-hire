import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import type { ApplicationStage } from "../schemas/application.schema.js";
import { updateStageSchema } from "../schemas/application.schema.js";
import { supabaseAdmin } from "../config/supabase.js";

const router = Router();

/**
 * State Transition Rules Table
 * Defines which stages can transition to which next stages.
 */
const VALID_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  applied: ["screening", "rejected"],
  screening: ["interview", "rejected"],
  interview: ["offer", "rejected"],
  offer: ["rejected"],
  rejected: [], // Terminal state! Cannot move out of rejected!
};

/**
 * PATCH /applications/:id
 * Moves an application to a new stage with strict state validation & optimistic locking
 */
router.patch(
  "/:id",
  requireAuth,
  requireRole("recruiter"),
  validate(updateStageSchema, "body"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { stage: targetStage, version } = req.body;

      // 1. Fetch current application + verify job recruiter ownership
      const { data: application, error: fetchError } = await supabaseAdmin
        .from("applications")
        .select("id, stage, version, job_id, jobs!job_id(recruiter_id)")
        .eq("id", id)
        .single();

      if (fetchError || !application) {
        return res
          .status(404)
          .json({ success: false, error: "Application not found" });
      }

      // 2. Authorization check: Does the recruiter own this job?
      const job = application.jobs as any;
      if (!job || job.recruiter_id !== req.user!.id) {
        return res.status(403).json({
          success: false,
          error:
            "Forbidden: You are not authorized to update applications on this job.",
        });
      }

      const currentStage = application.stage as ApplicationStage;

      // 3. Rule: Cannot move an already rejected application!
      if (currentStage === "rejected") {
        return res.status(400).json({
          success: false,
          error:
            "Invalid transition: A rejected application cannot be moved to any other stage.",
        });
      }

      // 4. Rule: Must follow the sequential progression (e.g. no jumping applied -> offer)
      const allowedNextStages = VALID_TRANSITIONS[currentStage];
      if (!allowedNextStages.includes(targetStage)) {
        return res.status(400).json({
          success: false,
          error: `Invalid transition: Cannot move directly from '${currentStage}' to '${targetStage}'. Allowed next stages:${allowedNextStages.join(", ")}`,
        });
      }

      // 5. Update with OPTIMISTIC LOCKING (Part 3.5)
      let updateQuery = supabaseAdmin
        .from("applications")
        .update({
          stage: targetStage,
          version: application.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      // If client supplied a version, enforce it matches
      if (version !== undefined) {
        updateQuery = updateQuery.eq("version", version);
      } else {
        updateQuery = updateQuery.eq("version", application.version);
      }

      const { data: updated, error: updateError } = await updateQuery
        .select()
        .single();

      if (updateError || !updated) {
        // Version mismatch! Another user updated it concurrently!
        return res.status(409).json({
          success: false,
          error:
            "Conflict: This application was updated by another session. Please refresh your view.",
        });
      }

      return res.json({
        success: true,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
