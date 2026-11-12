"use client";

import { Suspense, useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/context/auth-context";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  IconSearch,
  IconPlus,
  IconBriefcase,
  IconMapPin,
  IconAlertCircle,
} from "@tabler/icons-react";

export interface Job {
  id: string;
  recruiter_id: string;
  title: string;
  description: string;
  location: string;
  status: "open" | "closed" | "draft";
  created_at: string;
  profiles?: {
    full_name: string;
    email: string;
  };
}

interface JobsApiResponse {
  success: boolean;
  data: Job[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function JobsListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  // Read URL query params on initial render
  const initialSearch = searchParams.get("search") || "";
  const initialStatus = searchParams.get("status") || "open";
  const initialPage = Number(searchParams.get("page") || 1);
  const initialTab = (searchParams.get("tab") as "all" | "mine") || "all";

  // Active tab state for recruiters: "all" (All Jobs) vs "mine" (Your Posts)
  const [activeTab, setActiveTab] = useState<"all" | "mine">(initialTab);

  // Search input state (immediate for typing responsiveness)
  const [searchInput, setSearchInput] = useState(initialSearch);

  // Debounced search term (updated after 300ms pause)
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);

  // Filter & pagination states
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [page, setPage] = useState(initialPage);

  // Recruiter "Create Job" modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newLocation, setNewLocation] = useState("Remote");
  const [newStatus, setNewStatus] = useState<"open" | "closed" | "draft">(
    "open",
  );

  // Helper to synchronize query params with URL without full page reload
  const updateUrlParams = useCallback(
    (search: string, status: string, pageNum: number, tabVal?: string) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status && status !== "open") params.set("status", status);
      if (pageNum > 1) params.set("page", pageNum.toString());
      const currentTab = tabVal !== undefined ? tabVal : activeTab;
      if (currentTab === "mine") params.set("tab", "mine");

      const queryString = params.toString();
      router.replace(queryString ? `/jobs?${queryString}` : "/jobs", {
        scroll: false,
      });
    },
    [router, activeTab],
  );

  // Hand-written debounce closure (Part 3.6):
  // Wrapped in useMemo so the timer state inside the closure is preserved across renders!
  const debouncedSearchHandler = useMemo(
    () =>
      debounce((val: string) => {
        setDebouncedSearch(val);
        setPage(1);
        updateUrlParams(val, statusFilter, 1);
      }, 300),
    [statusFilter, updateUrlParams],
  );

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setSearchInput(value);
    debouncedSearchHandler(value);
  }

  function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextStatus = e.target.value;
    setStatusFilter(nextStatus);
    setPage(1);
    updateUrlParams(debouncedSearch, nextStatus, 1);
  }

  // TanStack Query: Fetch Jobs with automatic cancellation of stale in-flight requests via signal
  const isMineFilter = profile?.role === "recruiter" && activeTab === "mine";
  const { data, isLoading, isError, error, refetch } =
    useQuery<JobsApiResponse>({
      queryKey: [
        "jobs",
        {
          search: debouncedSearch,
          status: statusFilter,
          page,
          tab: profile?.role === "recruiter" ? activeTab : "all",
          recruiterId: isMineFilter ? profile?.id : undefined,
        },
      ],
      queryFn: ({ signal }) => {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: "9",
          status: statusFilter,
        });
        if (debouncedSearch) {
          params.set("search", debouncedSearch);
        }
        if (isMineFilter && profile?.id) {
          params.set("recruiter_id", profile.id);
        }
        return apiFetch<JobsApiResponse>(`/jobs?${params.toString()}`, {
          signal,
        });
      },
    });

  // TanStack Query Mutation: Create Job (Recruiter only)
  const createJobMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{ success: boolean; data: Job }>("/jobs", {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim(),
          location: newLocation.trim(),
          status: newStatus,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Job posted successfully!");
      setIsCreateOpen(false);
      setNewTitle("");
      setNewDescription("");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create job posting");
    },
  });

  const jobs = data?.data || [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages || 1;

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 space-y-8">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Job Listings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Browse open opportunities or manage your published roles.
          </p>
        </div>

        {/* RECRUITER ONLY: POST A JOB BUTTON & DIALOG */}
        {profile?.role === "recruiter" && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-1.5">
                <IconPlus className="size-4" />
                Post New Job
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Post a New Job Opportunity</DialogTitle>
                <DialogDescription>
                  Enter the position details. This job will be assigned to your
                  recruiter profile.
                </DialogDescription>
              </DialogHeader>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createJobMutation.mutate();
                }}
                className="space-y-4 py-2"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="job-title">Job Title</Label>
                  <Input
                    id="job-title"
                    placeholder="e.g. Senior Full-Stack Engineer"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    required
                    minLength={3}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="job-location">Location</Label>
                  <Input
                    id="job-location"
                    placeholder="e.g. Remote, San Francisco, CA"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="job-status">Listing Status</Label>
                  <NativeSelect
                    id="job-status"
                    value={newStatus}
                    onChange={(e) =>
                      setNewStatus(
                        e.target.value as "open" | "closed" | "draft",
                      )
                    }
                  >
                    <option value="open">Open (Publicly Visible)</option>
                    <option value="closed">Closed</option>
                    <option value="draft">Draft</option>
                  </NativeSelect>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="job-desc">Job Description</Label>
                  <Textarea
                    id="job-desc"
                    placeholder="Describe role responsibilities, qualifications, and benefits..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    required
                    minLength={10}
                    className="min-h-28"
                  />
                </div>

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateOpen(false)}
                    disabled={createJobMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createJobMutation.isPending}>
                    {createJobMutation.isPending
                      ? "Publishing Job..."
                      : "Publish Job"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* RECRUITER TABS: ALL JOBS VS YOUR POSTS */}
      {profile?.role === "recruiter" && (
        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            const nextTab = val as "all" | "mine";
            setActiveTab(nextTab);
            setPage(1);
            updateUrlParams(debouncedSearch, statusFilter, 1, nextTab);
          }}
          className="w-full sm:w-auto"
        >
          <TabsList>
            <TabsTrigger value="all">All Jobs</TabsTrigger>
            <TabsTrigger value="mine">Your Posts</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* FILTER & SEARCH BAR */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search jobs by title..."
            value={searchInput}
            onChange={handleSearchChange}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <Label
            htmlFor="filter-status"
            className="text-sm text-muted-foreground whitespace-nowrap"
          >
            Status:
          </Label>
          <NativeSelect
            id="filter-status"
            value={statusFilter}
            onChange={handleStatusChange}
            className="w-36"
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="draft">Draft</option>
          </NativeSelect>
        </div>
      </div>

      {/* 🔴 ERROR STATE */}
      {isError && (
        <Alert variant="destructive">
          <IconAlertCircle className="size-4" />
          <AlertTitle>Failed to load jobs</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {(error as Error)?.message || "Network error occurred."}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="ml-4"
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 🟡 LOADING SKELETON STATE */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card key={idx} className="space-y-3 p-6">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-9 w-full mt-4" />
            </Card>
          ))}
        </div>
      )}

      {/* ⚪ EMPTY STATE */}
      {!isLoading && !isError && jobs.length === 0 && (
        <Card className="p-12 text-center border-dashed">
          <div className="flex flex-col items-center justify-center space-y-2">
            <IconBriefcase className="size-10 text-muted-foreground stroke-1" />
            <h3 className="text-lg font-semibold">
              {activeTab === "mine"
                ? "You haven't posted any jobs yet"
                : "No job postings found"}
            </h3>
            <p className="text-muted-foreground text-sm max-w-sm">
              {activeTab === "mine"
                ? "Click 'Post New Job' above to publish your first open role."
                : debouncedSearch
                  ? `No results match your search "${debouncedSearch}". Try different keywords.`
                  : `There are currently no jobs listed with status '${statusFilter}'.`}
            </p>
            {activeTab === "mine" && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5"
                onClick={() => setIsCreateOpen(true)}
              >
                <IconPlus className="size-4" />
                Post a Job
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* 🟢 SUCCESS STATE: JOB CARDS */}
      {!isLoading && !isError && jobs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {jobs.map((job) => {
            const isOwnJob =
              profile?.role === "recruiter" && profile?.id === job.recruiter_id;
            return (
              <Card
                key={job.id}
                className="flex flex-col justify-between hover:border-foreground/20 transition-colors"
              >
                <CardHeader className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 flex-1 min-w-0">
                      <CardTitle className="text-base font-semibold line-clamp-1">
                        {job.title}
                      </CardTitle>
                      {isOwnJob && (
                        <Badge
                          variant="outline"
                          className="border-primary/40 text-primary bg-primary/5 text-[11px] font-medium"
                        >
                          Your Post
                        </Badge>
                      )}
                    </div>
                    <Badge
                      variant={
                        job.status === "open"
                          ? "default"
                          : job.status === "closed"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {job.status}
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-1.5 text-xs">
                    <IconMapPin className="size-3.5 text-muted-foreground" />
                    <span>{job.location || "Remote"}</span>
                    <span>•</span>
                    <span>
                      Posted by {isOwnJob ? "you" : job.profiles?.full_name || "Recruiter"}
                    </span>
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                    {job.description}
                  </p>
                </CardContent>

                <CardFooter className="pt-2">
                  <Link href={`/jobs/${job.id}`} className="w-full">
                    <Button variant="outline" className="w-full text-sm">
                      {isOwnJob ? "Manage Job & Applicants" : "View Job Details"}
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* PAGINATION CONTROLS */}
      {!isLoading && !isError && totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Showing Page{" "}
            <span className="font-semibold text-foreground">{page}</span> of{" "}
            <span className="font-semibold text-foreground">{totalPages}</span>
          </p>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const prev = page - 1;
                setPage(prev);
                updateUrlParams(debouncedSearch, statusFilter, prev);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => {
                const next = page + 1;
                setPage(next);
                updateUrlParams(debouncedSearch, statusFilter, next);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="container max-w-5xl mx-auto py-12 text-center text-muted-foreground">
          Loading jobs...
        </div>
      }
    >
      <JobsListContent />
    </Suspense>
  );
}
