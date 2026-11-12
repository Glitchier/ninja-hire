"use client";

import { useState, useEffect, useRef } from "react";

export interface Job {
  id: string;
  title: string;
  description: string;
  location: string;
  status: string;
  created_at: string;
}

export function useJobSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store the active controller across renders using a ref
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // 1. Cancel any previously in-flight HTTP request!
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
    }

    // 2. Create a new controller for the current search
    const controller = new AbortController();
    activeControllerRef.current = controller;

    async function fetchJobs() {
      setLoading(true);
      setError(null);

      try {
        // Point to your backend endpoint (e.g. backend URL or Next.js proxy route)
        const backendUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
        const res = await fetch(
          `${backendUrl}/jobs?search=${encodeURIComponent(searchQuery)}`,
          {
            signal: controller.signal,
          },
        );

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }

        const data = await res.json();
        setJobs(data.data || []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        // 3. Ignored: request was cleanly canceled because the user kept typing!
        if (err.name === "AbortError") {
          return;
        }
        console.error("Fetch error:", err);
        setError(err.message || "Failed to load jobs");
      } finally {
        // Only turn off loading if this request wasn't canceled
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchJobs();

    // Cleanup: cancel request if component unmounts
    return () => {
      controller.abort();
    };
  }, [searchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    jobs,
    loading,
    error,
  };
}
