"use client";

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  IconFileSpreadsheet,
  IconUpload,
  IconArrowLeft,
  IconCheck,
  IconFileText,
  IconUsers,
  IconMapPin,
  IconAlertCircle,
} from "@tabler/icons-react";

export interface JobDetail {
  id: string;
  recruiter_id: string;
  title: string;
  description: string;
  location: string;
  status: "open" | "closed" | "draft";
  created_at: string;
  application_count: number;
  profiles?: {
    full_name: string;
    email: string;
  };
}

export interface Application {
  id: string;
  job_id: string;
  candidate_id: string;
  stage: "applied" | "screening" | "interview" | "offer" | "rejected";
  resume_url: string;
  version: number;
  created_at: string;
  profiles?: {
    full_name: string;
    email: string;
  };
}

interface ApplicationsApiResponse {
  success: boolean;
  data: Application[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function JobDetailContent() {
  const params = useParams();
  const router = useRouter();
  const jobId = params?.id as string;
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  // Selected applications for Part 3.2 bulk actions
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string>("");
  const [bulkTargetStage, setBulkTargetStage] = useState<string>("screening");

  // Candidate apply file state
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [applyValidationError, setApplyValidationError] = useState<string | null>(null);

  // 1. Fetch Job Info
  const {
    data: jobData,
    isLoading: jobLoading,
    isError: jobIsError,
    error: jobError,
    refetch: refetchJob,
  } = useQuery<{ success: boolean; data: JobDetail }>({
    queryKey: ["job", jobId],
    queryFn: () => apiFetch<{ success: boolean; data: JobDetail }>(`/jobs/${jobId}`),
    enabled: !!jobId,
  });

  const job = jobData?.data;
  const isOwnerRecruiter = profile?.role === "recruiter" && job?.recruiter_id === profile.id;

  // 2. Fetch Applications (Only enabled if the user is a recruiter)
  const {
    data: appsData,
    isLoading: appsLoading,
    isError: appsIsError,
    error: appsError,
    refetch: refetchApps,
  } = useQuery<ApplicationsApiResponse>({
    queryKey: ["job-applications", jobId, { stage: stageFilter }],
    queryFn: () => {
      const qs = stageFilter ? `?stage=${stageFilter}` : "";
      return apiFetch<ApplicationsApiResponse>(`/jobs/${jobId}/applications${qs}`);
    },
    enabled: !!jobId && profile?.role === "recruiter",
  });

  const applications = appsData?.data || [];

  // =========================================================================
  // 🚀 OPTIMISTIC UPDATE MUTATION WITH AUTOMATIC ROLLBACK (Assignment Part 2)
  // =========================================================================
  const updateStageMutation = useMutation({
    mutationFn: async ({
      appId,
      newStage,
      currentVersion,
    }: {
      appId: string;
      newStage: string;
      currentVersion: number;
    }) => {
      return apiFetch(`/applications/${appId}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: newStage, version: currentVersion }),
      });
    },

    // Step 1: onMutate runs before network request fires!
    onMutate: async ({ appId, newStage }) => {
      // Cancel in-flight queries so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["job-applications", jobId] });

      // Snapshot previous application state for rollback
      const previousData = queryClient.getQueryData<ApplicationsApiResponse>([
        "job-applications",
        jobId,
        { stage: stageFilter },
      ]);

      // Optimistically update the UI state immediately
      if (previousData) {
        queryClient.setQueryData<ApplicationsApiResponse>(
          ["job-applications", jobId, { stage: stageFilter }],
          {
            ...previousData,
            data: previousData.data.map((app) =>
              app.id === appId ? { ...app, stage: newStage as any } : app
            ),
          }
        );
      }

      return { previousData };
    },

    // Step 2: If the request fails, ROLLBACK to the previous snapshot!
    onError: (err: any, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(
          ["job-applications", jobId, { stage: stageFilter }],
          context.previousData
        );
      }
      toast.error(`Stage update failed: ${err.message}. Rolled back.`);
    },

    // Step 3: Always invalidate on settled to guarantee server sync
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["job-applications", jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },

    onSuccess: () => {
      toast.success("Stage updated successfully!");
    },
  });

  // 3. Candidate Apply Mutation (with disabled button in-flight to prevent double-submit)
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!resumeFile) {
        throw new Error("Please select a resume file (PDF or DOCX).");
      }

      // Check 5MB limit on client before uploading
      if (resumeFile.size > 5 * 1024 * 1024) {
        throw new Error("File size exceeds 5MB limit.");
      }

      const formData = new FormData();
      formData.append("resume", resumeFile);

      return apiFetch(`/jobs/${jobId}/applications`, {
        method: "POST",
        body: formData,
      });
    },
    onSuccess: () => {
      toast.success("Application submitted successfully! Confirmation email queued.");
      setResumeFile(null);
      setApplyValidationError(null);
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
    onError: (err: any) => {
      setApplyValidationError(err.message || "Failed to submit application");
      toast.error(err.message || "Application failed");
    },
  });

  // 4. Bulk Stage Mutation (Part 3.2 Concurrency Limiter)
  const bulkStageMutation = useMutation({
    mutationFn: async () => {
      if (selectedAppIds.length === 0) {
        throw new Error("No applications selected.");
      }
      return apiFetch<{
        success: boolean;
        summary: { total: number; succeeded: number; failed: number };
      }>(`/jobs/${jobId}/applications/bulk-stage`, {
        method: "POST",
        body: JSON.stringify({
          applicationIds: selectedAppIds,
          stage: bulkTargetStage,
        }),
      });
    },
    onSuccess: (res) => {
      toast.success(
        `Bulk update finished: ${res.summary.succeeded} succeeded, ${res.summary.failed} failed.`
      );
      setSelectedAppIds([]);
      queryClient.invalidateQueries({ queryKey: ["job-applications", jobId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Bulk stage update failed");
    },
  });

  // Helper to open private signed resume URL
  async function handleViewResume(resumePath: string) {
    try {
      const { data, error } = await supabase.storage
        .from("resumes")
        .createSignedUrl(resumePath, 60); // 60 seconds expiring link

      if (error || !data?.signedUrl) {
        toast.error("Could not generate signed URL for resume.");
        return;
      }

      window.open(data.signedUrl, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to open resume");
    }
  }

  // Loading Job skeleton
  if (jobLoading) {
    return (
      <div className="container max-w-5xl mx-auto py-8 px-4 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card className="p-6 space-y-4">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </div>
    );
  }

  // Job error state
  if (jobIsError || !job) {
    return (
      <div className="container max-w-5xl mx-auto py-12 px-4">
        <Alert variant="destructive">
          <IconAlertCircle className="size-4" />
          <AlertTitle>Job Not Found</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{(jobError as Error)?.message || "The requested job posting could not be loaded."}</span>
            <Button variant="outline" size="sm" onClick={() => router.push("/jobs")}>
              Back to Jobs
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 space-y-8">
      {/* BACK NAVIGATION */}
      <div>
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
          <IconArrowLeft className="size-4" />
          Back to all jobs
        </Link>
      </div>

      {/* JOB OVERVIEW CARD */}
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <CardTitle className="text-2xl font-bold">{job.title}</CardTitle>
              <CardDescription className="flex items-center gap-2 text-sm mt-1">
                <span className="flex items-center gap-1">
                  <IconMapPin className="size-4 text-muted-foreground" />
                  {job.location || "Remote"}
                </span>
                <span>•</span>
                <span>Posted by {job.profiles?.full_name || "Recruiter"}</span>
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={job.status === "open" ? "default" : "secondary"}>
                {job.status}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <IconUsers className="size-3.5" />
                {job.application_count} Applicants
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-1">About the Role</h3>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {job.description}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* =================================================================== */}
      {/* CANDIDATE SECTION: APPLY WITH RESUME                                */}
      {/* =================================================================== */}
      {(!user || profile?.role === "candidate") && (
        <Card className="border">
          <CardHeader>
            <CardTitle className="text-lg">Apply for this Job</CardTitle>
            <CardDescription>
              Submit your resume (PDF or DOCX, up to 5MB). You will receive an email confirmation upon submission.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {!user ? (
              <div className="p-4 bg-muted/50 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  You must be logged in as a candidate to apply.
                </span>
                <Link href="/login">
                  <Button size="sm">Sign In to Apply</Button>
                </Link>
              </div>
            ) : job.status !== "open" ? (
              <Alert>
                <IconAlertCircle className="size-4" />
                <AlertTitle>Applications Closed</AlertTitle>
                <AlertDescription>
                  This job posting is no longer accepting new candidate applications.
                </AlertDescription>
              </Alert>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  applyMutation.mutate();
                }}
                className="space-y-4"
              >
                {applyValidationError && (
                  <Alert variant="destructive">
                    <IconAlertCircle className="size-4" />
                    <AlertTitle>Cannot Submit</AlertTitle>
                    <AlertDescription>{applyValidationError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <label htmlFor="resume-upload" className="text-sm font-medium">
                    Resume / CV File
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                    <input
                      id="resume-upload"
                      type="file"
                      accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setResumeFile(file);
                        setApplyValidationError(null);
                      }}
                      disabled={applyMutation.isPending}
                      className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                      required
                    />

                    {/* SUBMIT BUTTON WITH DISABLED STATE DURING IN-FLIGHT REQUEST */}
                    <Button
                      type="submit"
                      disabled={applyMutation.isPending || !resumeFile}
                      className="gap-1.5"
                    >
                      <IconUpload className="size-4" />
                      {applyMutation.isPending ? "Submitting Application..." : "Submit Application"}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* =================================================================== */}
      {/* RECRUITER SECTION: APPLICANT PIPELINE & STAGE MANAGEMENT           */}
      {/* =================================================================== */}
      {profile?.role === "recruiter" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Applicant Management</h2>
              <p className="text-sm text-muted-foreground">
                Move candidates through stages or perform bulk transitions.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Part 3.3 CSV Export Button */}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  try {
                    const { data: sessionData } = await supabase.auth.getSession();
                    const token = sessionData.session?.access_token;
                    const res = await fetch(`${API_BASE}/jobs/${jobId}/export`, {
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    });
                    if (!res.ok) throw new Error("Export failed");
                    const blob = await res.blob();
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = downloadUrl;
                    a.download = `job-${jobId}-applications.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    toast.success("CSV export downloaded successfully!");
                  } catch (err: any) {
                    toast.error(err.message || "Failed to export CSV");
                  }
                }}
              >
                <IconFileSpreadsheet className="size-4" />
                Export CSV
              </Button>

              {/* Stage Filter */}
              <NativeSelect
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                size="sm"
                className="w-36"
              >
                <option value="">All Stages</option>
                <option value="applied">Applied</option>
                <option value="screening">Screening</option>
                <option value="interview">Interview</option>
                <option value="offer">Offer</option>
                <option value="rejected">Rejected</option>
              </NativeSelect>
            </div>
          </div>

          {/* BULK ACTIONS TOOLBAR (Part 3.2 Concurrency Limiter) */}
          {selectedAppIds.length > 0 && (
            <Card className="p-3 bg-muted/60 border border-primary/20">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  {selectedAppIds.length} candidate{selectedAppIds.length > 1 ? "s" : ""} selected
                </span>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Move to:</span>
                  <NativeSelect
                    value={bulkTargetStage}
                    onChange={(e) => setBulkTargetStage(e.target.value)}
                    size="sm"
                    className="w-32"
                  >
                    <option value="screening">Screening</option>
                    <option value="interview">Interview</option>
                    <option value="offer">Offer</option>
                    <option value="rejected">Rejected</option>
                  </NativeSelect>

                  <Button
                    size="sm"
                    disabled={bulkStageMutation.isPending}
                    onClick={() => bulkStageMutation.mutate()}
                  >
                    {bulkStageMutation.isPending ? "Applying..." : "Apply Bulk Update"}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* ERROR LOADING APPLICATIONS */}
          {appsIsError && (
            <Alert variant="destructive">
              <IconAlertCircle className="size-4" />
              <AlertTitle>Authorization / Loading Error</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>{(appsError as Error)?.message || "Could not fetch applicants."}</span>
                <Button variant="outline" size="sm" onClick={() => refetchApps()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* APPLICANTS TABLE */}
          {appsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : applications.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <p className="text-muted-foreground text-sm">
                No applicants match the selected stage filter.
              </p>
            </Card>
          ) : (
            <div className="border rounded-lg overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">
                      <Checkbox
                        checked={
                          selectedAppIds.length === applications.length && applications.length > 0
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedAppIds(applications.map((a) => a.id));
                          } else {
                            setSelectedAppIds([]);
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Resume</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Change Stage (Optimistic)</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {applications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={selectedAppIds.includes(app.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedAppIds((prev) => [...prev, app.id]);
                            } else {
                              setSelectedAppIds((prev) => prev.filter((id) => id !== app.id));
                            }
                          }}
                        />
                      </TableCell>

                      <TableCell className="font-medium">
                        {app.profiles?.full_name || "Applicant"}
                      </TableCell>

                      <TableCell className="text-muted-foreground text-sm">
                        {app.profiles?.email || "—"}
                      </TableCell>

                      <TableCell>
                        {app.resume_url ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="gap-1 text-xs"
                            onClick={() => handleViewResume(app.resume_url)}
                          >
                            <IconFileText className="size-3.5" />
                            View Resume
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant={
                            app.stage === "offer"
                              ? "default"
                              : app.stage === "rejected"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {app.stage}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right">
                        {/* SELECT WITH OPTIMISTIC UPDATE AND ROLLBACK */}
                        <NativeSelect
                          value={app.stage}
                          size="sm"
                          disabled={
                            updateStageMutation.isPending || app.stage === "rejected"
                          }
                          onChange={(e) => {
                            const target = e.target.value;
                            updateStageMutation.mutate({
                              appId: app.id,
                              newStage: target,
                              currentVersion: app.version,
                            });
                          }}
                          className="w-32 inline-block"
                        >
                          <option value="applied">applied</option>
                          <option value="screening">screening</option>
                          <option value="interview">interview</option>
                          <option value="offer">offer</option>
                          <option value="rejected">rejected</option>
                        </NativeSelect>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function JobDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="container max-w-5xl mx-auto py-12 text-center text-muted-foreground">
          Loading job details...
        </div>
      }
    >
      <JobDetailContent />
    </Suspense>
  );
}
