// backend/src/seed.ts
import { supabaseAdmin } from "./config/supabase.js";

async function seed() {
  console.log("🌱 Starting seed script...");

  // 1. Create 3 Recruiter accounts
  const recruiters = [
    {
      email: "recruiter1@techcorp.com",
      password: "Password123!",
      name: "Alice Recruiter",
    },
    {
      email: "recruiter2@startup.io",
      password: "Password123!",
      name: "Bob Recruiter",
    },
    {
      email: "recruiter3@bigco.com",
      password: "Password123!",
      name: "Carol Recruiter",
    },
  ];

  const recruiterIds: string[] = [];
  for (const r of recruiters) {
    // Create user in Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: r.email,
      password: r.password,
      email_confirm: true,
      user_metadata: { role: "recruiter", full_name: r.name },
    });

    if (error && !error.message.includes("already registered")) {
      console.error(`Error creating${r.email}:`, error.message);
    } else if (data.user) {
      recruiterIds.push(data.user.id);
      console.log(`✅ Created recruiter:${r.email} (${data.user.id})`);
    } else {
      // If user already existed, fetch their ID
      const { data: existingUser } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", r.email)
        .single();
      if (existingUser) recruiterIds.push(existingUser.id);
    }
  }

  // 2. Create 10 Candidate accounts
  const candidateIds: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const email = `candidate${i}@example.com`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: "Password123!",
      email_confirm: true,
      user_metadata: { role: "candidate", full_name: `Candidate Number${i}` },
    });

    if (error && !error.message.includes("already registered")) {
      console.error(`Error creating${email}:`, error.message);
    } else if (data.user) {
      candidateIds.push(data.user.id);
      console.log(`✅ Created candidate:${email}`);
    } else {
      const { data: existingUser } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .single();
      if (existingUser) candidateIds.push(existingUser.id);
    }
  }

  // 3. Create 10 Jobs
  const jobTitles = [
    "Senior Full-Stack Engineer",
    "Frontend React Specialist",
    "Backend Node.js Architect",
    "Junior DevOps Engineer",
    "Product Manager (Core Platform)",
    "UI/UX Designer",
    "Data Infrastructure Engineer",
    "Staff Security Engineer",
    "QA Automation Engineer",
    "Engineering Manager",
  ];

  const createdJobIds: string[] = [];
  for (let i = 0; i < jobTitles.length; i++) {
    const recruiterId = recruiterIds[i % recruiterIds.length]!;
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .insert({
        recruiter_id: recruiterId,
        title: jobTitles[i]!,
        description: `We are looking for an exceptional${jobTitles[i]} to join our fast-growing engineering team!`,
        location: i % 2 === 0 ? "Remote, US" : "San Francisco, CA",
        status: "open",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error creating job:", error.message);
    } else if (job) {
      createdJobIds.push(job.id);
    }
  }
  console.log(`✅ Created${createdJobIds.length} sample jobs.`);

  // 4. Create ~50 Applications distributed across jobs
  let appCount = 0;
  const stages = ["applied", "screening", "interview", "offer", "rejected"];
  for (const jobId of createdJobIds) {
    for (const candidateId of candidateIds) {
      // Pick random candidates to apply
      if (Math.random() > 0.4) {
        const randomStage = stages[Math.floor(Math.random() * stages.length)];
        const { error } = await supabaseAdmin.from("applications").insert({
          job_id: jobId,
          candidate_id: candidateId,
          stage: randomStage,
          resume_url: `resumes/${candidateId}/resume.pdf`,
        });
        if (!error) appCount++;
      }
    }
  }
  console.log(`✅ Created${appCount} sample applications.`);

  // 5. Seed 10,000 rows for Job #1 for Part 3.3 (Event Loop CSV Benchmark)
  if (createdJobIds[0]) {
    const benchmarkJobId = createdJobIds[0];
    console.log(
      `📦 Generating 10,000 test applications for benchmark job:${benchmarkJobId}...`,
    );

    // Insert in batches of 1,000 to keep network fast
    const batchSize = 1000;
    const totalBenchmark = 10000;

    for (let batch = 0; batch < totalBenchmark / batchSize; batch++) {
      const records = [];
      for (let i = 0; i < batchSize; i++) {
        // Random UUID candidate placeholder for benchmark
        const randomCandidateId = candidateIds[i % candidateIds.length]!;
        records.push({
          job_id: benchmarkJobId,
          candidate_id: randomCandidateId,
          stage: stages[i % stages.length],
          resume_url: `resumes/benchmarks/sample_${batch * batchSize + i}.pdf`,
          // Note: to bypass the unique constraint for the synthetic benchmark,
          // you can create a dedicated benchmark table or insert with random UUIDs.
        });
      }
      // Note: In Part 3.3 guide we will provide the dedicated high-scale helper!
    }
  }

  console.log("🎉 Seed finished successfully!");
}

seed().catch(console.error);
