// backend/src/middleware/auth.ts
import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase.js";

// Extend Express Request type to attach the authenticated user
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: "recruiter" | "candidate";
  full_name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      token?: string;
    }
  }
}

/**
 * Middleware: requireAuth
 * Extracts the Bearer JWT token from the Authorization header,
 * validates it against Supabase Auth, and fetches the user's profile role.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Authentication required: Missing or malformed Bearer token",
    });
  }

  const token = authHeader.split(" ")[1]!;

  try {
    // 1. Verify token with Supabase Auth
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.getUser(token);

    if (authError || !authData.user) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired session token",
      });
    }

    // 2. Fetch the user's role from profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, role, full_name")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({
        success: false,
        error: "User profile not found",
      });
    }

    // Attach user and raw token to request object
    req.user = profile as AuthenticatedUser;
    req.token = token;
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Authentication service unavailable",
    });
  }
}

/**
 * Middleware: requireRole
 * Enforces Role-Based Access Control (RBAC).
 * Example: requireRole("recruiter") rejects candidates with HTTP 403.
 */
export function requireRole(allowedRole: "recruiter" | "candidate") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Unauthenticated" });
    }

    if (req.user.role !== allowedRole) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: This action requires the '${allowedRole}' role. You are logged in as '${req.user.role}'.`,
      });
    }

    next();
  };
}
