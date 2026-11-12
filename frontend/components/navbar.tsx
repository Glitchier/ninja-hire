"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "./theme-toggle";

export function Navbar() {
  const { user, profile, signOut, isLoading } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:backdrop-blur">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link
            href="/jobs"
            className="flex items-center gap-2 font-bold tracking-tight text-foreground hover:opacity-80 transition"
          >
            <span className="text-xl">🥋 Ninja ATS</span>
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <Link
            href="/jobs"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition"
          >
            Jobs
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <ModeToggle />
          {isLoading ? (
            <div className="h-8 w-24 rounded bg-muted animate-pulse" />
          ) : user && profile ? (
            <>
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-block text-sm font-medium text-foreground">
                  {profile.full_name}
                </span>
                <Badge
                  variant={
                    profile.role === "recruiter" ? "default" : "secondary"
                  }
                >
                  {profile.role}
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                Sign Out
              </Button>
            </>
          ) : (
            <Link href="/login">
              <Button size="sm">Sign In</Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
