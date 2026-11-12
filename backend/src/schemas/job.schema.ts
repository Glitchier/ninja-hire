import { z } from "zod";

export const createJobSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(100),
  description: z.string().min(10, "Description must be at least 10 characters"),
  location: z.string().default("Remote"),
  status: z.enum(["open", "closed", "draft"]).default("open"),
});

export const getJobsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(["open", "closed", "draft"]).optional(),
  search: z.string().optional(),
});

export const getApplicationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  stage: z
    .enum(["applied", "screening", "interview", "offer", "rejected"])
    .optional(),
});
