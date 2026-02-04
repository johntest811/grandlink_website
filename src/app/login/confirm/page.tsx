"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingSuccess from "../LoadingSuccess";
import { supabase } from "../../Clients/Supabase/SupabaseClients";

// Ensure this page is rendered dynamically (no prerender), fixing Vercel build errors
export const dynamic = "force-dynamic";

const PENDING_OAUTH_SESSION_KEY = "gl_oauth_pending_session";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function ConfirmLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>("");
  const [working, setWorking] = useState<boolean>(true);

  useEffect(() => {
    const doExchange = async () => {
      try {
        // Supabase sends a "code" param for magic links and password recovery
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const errParam = url.searchParams.get("error");
        const hash = window.location.hash || "";

        if (errParam) {
          setError(errParam);
          setWorking(false);
          return;
        }

        // Session can take a moment to be persisted client-side after exchange.
        // Retry a few times so we can reliably stash tokens.
        let session = (await supabase.auth.getSession()).data.session;
        for (let i = 0; !session && i < 5; i++) {
          await sleep(120);
          session = (await supabase.auth.getSession()).data.session;
        }

        if (!session) {
          setError("Failed to complete sign-in session. Please try again.");
          setWorking(false);
          return;
        }

        // Two possible flows depending on Supabase link version:
        // 1) New PKCE flow with ?code=... -> use exchangeCodeForSession
        // 2) Older hash-based flow with #access_token=... -> use getSessionFromUrl
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setError(error.message || "Failed to complete sign-in. Try again.");
            setWorking(false);
            return;
          }
        } else if (hash.includes("access_token") || hash.includes("refresh_token")) {
          const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
          const access_token = hashParams.get("access_token") || undefined;
          const refresh_token = hashParams.get("refresh_token") || undefined;

          if (!access_token || !refresh_token) {
            setError("Invalid sign-in link payload. Please request a new link.");
            setWorking(false);
            return;
          }

          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) {
            setError(error.message || "Failed to complete sign-in. Try again.");
            setWorking(false);
            return;
          }
        } else {
          // No recognizable auth info in URL
          setError("Invalid or expired sign-in link. Please request a new one.");
          setWorking(false);
          return;
        }

        // If we successfully got a session, require a verification code before continuing.
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr) {
          setError(userErr.message || "Failed to read user session. Try again.");
          setWorking(false);
          return;
        }

        const userEmail = userData.user?.email || "";
        if (!userEmail) {
          setError("No email found for this account. Please try again.");
          setWorking(false);
          return;
        }

        // Store email so verify page can show it
        sessionStorage.setItem("login_email", userEmail);
        sessionStorage.setItem("login_flow", "oauth");

        // IMPORTANT: OAuth creates a Supabase session immediately.
        // We don't want the UI to show the user as logged in until they enter the verification code.
        sessionStorage.setItem(
          PENDING_OAUTH_SESSION_KEY,
          JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          })
        );

        // Send verification code
        const sendRes = await fetch("/api/auth/send-verification-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, resend: false }),
        });

        if (!sendRes.ok) {
          const msg = await sendRes.json().catch(() => null);
          sessionStorage.removeItem(PENDING_OAUTH_SESSION_KEY);
          await supabase.auth.signOut();
          setError(msg?.error || "Failed to send verification code. Please try again.");
          setWorking(false);
          return;
        }

        // Sign out BEFORE going to /login/verify so TopNav doesn't show the account prematurely.
        await supabase.auth.signOut();

        router.replace("/login/verify");
      } catch {
        setError("Failed to complete sign-in. Try again.");
        setWorking(false);
      }
    };

    doExchange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (working && !error) {
    return <LoadingSuccess />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6">
      <h2 className="text-2xl font-bold text-gray-800">Sign-in link error</h2>
      <p className="mt-2 text-gray-600 text-center max-w-md">
        {error || "We couldn’t verify your sign-in link. It may have expired. Please go back and request a new link."}
      </p>
      <button
        onClick={() => router.replace("/login")}
        className="mt-6 bg-[#232d3b] text-white font-semibold rounded px-4 py-2 hover:bg-[#1a222e] transition"
      >
        Back to Login
      </button>
    </div>
  );
}