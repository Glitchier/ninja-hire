"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { IconAlertTriangle } from "@tabler/icons-react";

export default function LoginPage() {
  const router = useRouter();

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Signup form state
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"candidate" | "recruiter">("candidate");

  // Inline validation error messages
  const [validationError, setValidationError] = useState<string | null>(null);

  // 1. TanStack Query Mutation: Login
  const loginMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      toast.success("Welcome back! Redirecting to jobs...");
      router.push("/jobs");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to log in");
    },
  });

  // 2. TanStack Query Mutation: Sign Up
  const signupMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail.trim(),
        password: signupPassword,
        options: {
          data: {
            full_name: fullName.trim(),
            role: role,
          },
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      toast.success("Account registered successfully! Redirecting...");
      router.push("/jobs");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create account");
    },
  });

  // Handlers
  function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (!loginEmail.includes("@")) {
      setValidationError("Please enter a valid email address.");
      return;
    }
    if (loginPassword.length < 6) {
      setValidationError("Password must be at least 6 characters.");
      return;
    }

    loginMutation.mutate();
  }

  function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (!fullName.trim()) {
      setValidationError("Please enter your full name.");
      return;
    }
    if (!signupEmail.includes("@")) {
      setValidationError("Please enter a valid email address.");
      return;
    }
    if (signupPassword.length < 6) {
      setValidationError("Password must be at least 6 characters.");
      return;
    }

    signupMutation.mutate();
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight">Ninja ATS</CardTitle>
          <CardDescription>Mini Applicant Tracking System</CardDescription>
        </CardHeader>

        <CardContent>
          {/* INLINE VALIDATION OR MUTATION ERROR ALERT */}
          {(validationError || loginMutation.error || signupMutation.error) && (
            <Alert variant="destructive" className="mb-4">
              <IconAlertTriangle className="size-4" />
              <AlertTitle>Action Failed</AlertTitle>
              <AlertDescription>
                {validationError ||
                  loginMutation.error?.message ||
                  signupMutation.error?.message}
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">Log In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            {/* TAB: LOGIN */}
            <TabsContent value="login">
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email">Email Address</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="recruiter1@techcorp.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    disabled={loginMutation.isPending}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    disabled={loginMutation.isPending}
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </TabsContent>

            {/* TAB: SIGN UP */}
            <TabsContent value="signup">
              <form onSubmit={handleSignupSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="signup-name">Full Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="Jane Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={signupMutation.isPending}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Email Address</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="candidate@example.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    disabled={signupMutation.isPending}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">Password (min 6 chars)</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    disabled={signupMutation.isPending}
                    required
                    minLength={6}
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <Label>I want to sign up as:</Label>
                  <RadioGroup
                    value={role}
                    onValueChange={(val: "candidate" | "recruiter") => setRole(val)}
                    className="flex gap-4 pt-1"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="candidate" id="role-candidate" />
                      <Label htmlFor="role-candidate" className="cursor-pointer font-normal">
                        Candidate
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="recruiter" id="role-recruiter" />
                      <Label htmlFor="role-recruiter" className="cursor-pointer font-normal">
                        Recruiter
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={signupMutation.isPending}
                >
                  {signupMutation.isPending ? "Creating Account..." : "Create Account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

