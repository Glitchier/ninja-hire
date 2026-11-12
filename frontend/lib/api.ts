import { supabase } from "./supabase/client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Retrieves a fresh, valid access token from Supabase, automatically refreshing
 * if the current access token is expired or within 60 seconds of expiring.
 */
async function getFreshAccessToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  let session = sessionData.session;

  if (!session) return null;

  // Check if access token is expired or expiring in <= 60 seconds
  if (session.expires_at) {
    const isExpiredOrStale = Date.now() / 1000 >= session.expires_at - 60;
    if (isExpiredOrStale) {
      try {
        const { data: refreshed, error } = await supabase.auth.refreshSession();
        if (!error && refreshed.session) {
          session = refreshed.session;
        }
      } catch {
        // Ignore refresh failure; fall back to current session
      }
    }
  }

  return session?.access_token || null;
}

/**
 * Custom API client that automatically fetches and attaches the current Supabase session token
 * to the Authorization header as required for authenticated backend routes.
 *
 * Automatically handles token refresh on 401 Unauthorized responses.
 */
export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getFreshAccessToken();

  const headers = new Headers(options.headers || {});

  // Set JSON content-type only if not sending FormData
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  // Attach JWT Bearer token if session exists
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  // If the server rejected the token with 401 (expired/invalid), attempt one reactive refresh and retry
  if (response.status === 401 && token) {
    try {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (!error && refreshed.session?.access_token) {
        headers.set(
          "Authorization",
          `Bearer ${refreshed.session.access_token}`,
        );
        response = await fetch(`${API_BASE}${endpoint}`, {
          ...options,
          headers,
        });
      } else {
        // If the session is permanently invalid, sign out locally so UI prompts for re-login
        if (typeof window !== "undefined") {
          await supabase.auth.signOut().catch(() => {});
        }
      }
    } catch {
      // Ignore refresh error
    }
  }

  const contentType = response.headers.get("content-type") || "";
  let data: unknown = null;

  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => null);
  }

  if (!response.ok) {
    const errorObj =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : null;
    const errorMessage =
      (typeof errorObj?.error === "string" && errorObj.error) ||
      (typeof errorObj?.message === "string" && errorObj.message) ||
      (typeof data === "string" && data) ||
      `Request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return data as T;
}
