-- ====================================================================
-- SUPABASE MIGRATION: ATS SCHEMA + RLS + STORAGE
-- ====================================================================

-- 1. Enable UUID Extension (pgcrypto / uuid-ossp if needed, gen_random_uuid is native in Postgres 13+)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- --------------------------------------------------------------------
-- 2. PROFILES TABLE (Linked to Supabase Auth)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('recruiter', 'candidate')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for searching profiles by role or email
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- --------------------------------------------------------------------
-- 3. JOBS TABLE (Created by Recruiters)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recruiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT DEFAULT 'Remote',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'draft')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for filtering jobs list and finding a recruiter's jobs
CREATE INDEX IF NOT EXISTS idx_jobs_recruiter_id ON public.jobs(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON public.jobs(created_at DESC);

-- Full-text search index for job titles (faster search)
CREATE INDEX IF NOT EXISTS idx_jobs_title_search ON public.jobs USING gin(to_tsvector('english', title));

-- --------------------------------------------------------------------
-- 4. APPLICATIONS TABLE (Candidates Applying to Jobs)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'rejected')),
    resume_url TEXT,
    -- VERSION COLUMN FOR OPTIMISTIC LOCKING (Part 3.5 race condition protection)
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- DUPLICATE PROTECTION CONSTRAINT: A candidate can only apply once per job!
    CONSTRAINT unique_candidate_per_job UNIQUE (job_id, candidate_id)
);

-- Indexes for application queries
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON public.applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_candidate_id ON public.applications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON public.applications(stage);
CREATE INDEX IF NOT EXISTS idx_applications_job_stage ON public.applications(job_id, stage);

-- --------------------------------------------------------------------
-- 5. TRIGGER: AUTO-CREATE PROFILE ON SUPABASE AUTH SIGNUP
-- --------------------------------------------------------------------
-- When a user registers through Supabase Auth, this function triggers automatically
-- and creates their profile entry with the role specified in raw_user_meta_data.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'full_name', 'User'),
        COALESCE(new.raw_user_meta_data->>'role', 'candidate')
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role;
    RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- --------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- --------------------------------------------------------------------
-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Profiles are readable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles are readable by authenticated users"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id);

-- Jobs Policies
DROP POLICY IF EXISTS "Anyone can view open jobs" ON public.jobs;
CREATE POLICY "Anyone can view open jobs"
    ON public.jobs FOR SELECT
    TO authenticated, anon
    USING (status = 'open' OR auth.uid() = recruiter_id);

DROP POLICY IF EXISTS "Recruiters can insert jobs" ON public.jobs;
CREATE POLICY "Recruiters can insert jobs"
    ON public.jobs FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = recruiter_id AND
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'recruiter')
    );

DROP POLICY IF EXISTS "Recruiters can update own jobs" ON public.jobs;
CREATE POLICY "Recruiters can update own jobs"
    ON public.jobs FOR UPDATE
    TO authenticated
    USING (auth.uid() = recruiter_id);

-- Applications Policies
DROP POLICY IF EXISTS "Candidates can view own applications" ON public.applications;
CREATE POLICY "Candidates can view own applications"
    ON public.applications FOR SELECT
    TO authenticated
    USING (auth.uid() = candidate_id);

DROP POLICY IF EXISTS "Recruiters can view applications for their jobs" ON public.applications;
CREATE POLICY "Recruiters can view applications for their jobs"
    ON public.applications FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.jobs
            WHERE public.jobs.id = public.applications.job_id
            AND public.jobs.recruiter_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Candidates can create applications" ON public.applications;
CREATE POLICY "Candidates can create applications"
    ON public.applications FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = candidate_id AND
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'candidate')
    );

DROP POLICY IF EXISTS "Recruiters can update stage for their jobs" ON public.applications;
CREATE POLICY "Recruiters can update stage for their jobs"
    ON public.applications FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.jobs
            WHERE public.jobs.id = public.applications.job_id
            AND public.jobs.recruiter_id = auth.uid()
        )
    );

-- --------------------------------------------------------------------
-- 7. SUPABASE STORAGE (Private 'resumes' Bucket)
-- --------------------------------------------------------------------
-- Create private bucket for resumes
INSERT INTO storage.buckets (id, name, public)
VALUES ('resumes', 'resumes', false)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
DROP POLICY IF EXISTS "Candidates can upload resume" ON storage.objects;
CREATE POLICY "Candidates can upload resume"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'resumes' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Candidates can view own resume" ON storage.objects;
CREATE POLICY "Candidates can view own resume"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'resumes' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Recruiters can view applicant resumes" ON storage.objects;
CREATE POLICY "Recruiters can view applicant resumes"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'resumes' AND
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.jobs j ON j.id = a.job_id
            WHERE j.recruiter_id = auth.uid()
            AND a.resume_url LIKE '%' || storage.objects.name || '%'
        )
    );
