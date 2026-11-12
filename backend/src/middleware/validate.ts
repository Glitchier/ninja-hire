import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

/**
 * Middleware generator to validate request body, query, or params.
 * Returns HTTP 400 with friendly validation error messages instead of crashing.
 */
export function validate(
  schema: z.ZodType,
  source: "body" | "query" | "params" = "body",
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const formattedErrors = result.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));

      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: formattedErrors,
      });
    }

    // In Express 5, req.query is a getter on prototype. Use Object.defineProperty to override safely.
    if (source === "query" || source === "params") {
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      req[source] = result.data;
    }
    next();
  };
}
