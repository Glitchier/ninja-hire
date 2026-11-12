import { z } from "zod";

// The allowed stages
export const ApplicationStages = [
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
] as const;
export type ApplicationStage = (typeof ApplicationStages)[number];

export const updateStageSchema = z.object({
  stage: z.enum(ApplicationStages, {
    error:
      "Stage must be one of: applied, screening, interview, offer, rejected",
  }),
  // Optional version for optimistic locking (Part 3.5)
  version: z.number().int().positive().optional(),
});
