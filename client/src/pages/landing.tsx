import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";

async function post(url: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, message: data?.message };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

export default function Landing() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post("/api/auth/request-code", { email });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || "Could not send a code. Please try again.");
      return;
    }
    setNotice(result.message || "Check your email for a 6-digit code.");
    setCode("");
    setStep("code");
  };

  const verifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post("/api/auth/verify-code", { email, code });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || "That code didn't work. Ask for a new one.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl" data-testid="text-landing-title">TownGrid CRM</CardTitle>
          <CardDescription>
            {step === "email"
              ? "Sign in with your email. We'll send you a 6-digit code."
              : `Enter the code we sent to ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || !email} data-testid="button-send-code">
                {busy ? "Sending…" : "Email me a code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
              <div className="space-y-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-2xl tracking-[0.5em]"
                  data-testid="input-code"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || code.length !== 6} data-testid="button-verify-code">
                {busy ? "Checking…" : "Sign in"}
              </Button>
              <div className="flex justify-between text-sm">
                <button type="button" className="text-muted-foreground underline" onClick={() => { setStep("email"); setError(null); }}>
                  Use a different email
                </button>
                <button type="button" className="text-muted-foreground underline" disabled={busy} onClick={() => requestCode()}>
                  Send a new code
                </button>
              </div>
            </form>
          )}
          {error && <p className="mt-4 text-sm text-destructive" data-testid="text-auth-error">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
