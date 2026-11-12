// backend/src/middleware/errorHandler.ts
import type { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  console.error("❌ Handled API Error:", err);

  // PostgreSQL unique constraint violation error code is 23505
  // Assignment: "Duplicate protection — same candidate can’t apply twice to one job. Enforce with DB constraint. Return 409."
  if (
    err.code === "23505" ||
    err.message?.includes("unique_candidate_per_job")
  ) {
    return res.status(409).json({
      success: false,
      error:
        "Conflict: You have already submitted an application for this job.",
    });
  }

  // Fallback 500 error
  const statusCode = err.status || 500;
  return res.status(statusCode).json({
    success: false,
    error: err.message || "An unexpected internal server error occurred",
  });
}
