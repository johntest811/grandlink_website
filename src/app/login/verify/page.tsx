"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../Clients/Supabase/SupabaseClients";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";

export default function VerifyPage() {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");
  const router = useRouter();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Get email from session storage
    const storedEmail = sessionStorage.getItem("login_email");
    if (storedEmail) {
      setEmail(storedEmail);
    } else {
      // Fallback for OAuth sessions: try to read the signed-in user's email
      supabase.auth.getUser().then(({ data }) => {
        const e = data.user?.email || "";
        if (!e) {
          router.push("/login");
          return;
        }
        sessionStorage.setItem("login_email", e);
        sessionStorage.setItem("login_flow", "oauth");
        setEmail(e);
      });
    }
    
    // Focus first input
    inputRefs.current[0]?.focus();
  }, [router]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return; // Only allow digits

    const newCode = [...code];
    newCode[index] = value.slice(-1); // Only take last character
    setCode(newCode);
    setError("");

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newCode = [...code];
    
    for (let i = 0; i < pastedData.length; i++) {
      newCode[i] = pastedData[i];
    }
    
    setCode(newCode);
    setError("");
    
    // Focus last filled input or next empty
    const nextIndex = Math.min(pastedData.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const verificationCode = code.join("");
    
    if (verificationCode.length !== 6) {
      setError("Please enter all 6 digits");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Verify the code
      const verifyResponse = await fetch("/api/auth/send-verification-code", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: verificationCode }),
      });

      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok) {
        setError(verifyData.error || "Invalid verification code");
        setLoading(false);
        return;
      }

      // Code is valid, now sign in the user
      const password = sessionStorage.getItem("login_password");

      if (password) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          setError("Failed to sign in. Please try again.");
          setLoading(false);
          return;
        }
      } else {
        // OAuth flow: the user should already have an active Supabase session.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          setError("Session expired. Please login again.");
          router.push("/login");
          return;
        }
      }

      // Clear session storage
      sessionStorage.removeItem("login_email");
      sessionStorage.removeItem("login_password");
      sessionStorage.removeItem("login_flow");

      // Redirect to home
      router.push("/home");
    } catch (err: any) {
      console.error("Verification error:", err);
      setError("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/send-verification-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, resend: true }),
      });

  const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to resend code");
      } else {
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        // Show success message from server (may indicate rate limit wait)
        setError("");
        alert(data?.message || "Verification code sent to your email!");
      }
    } catch (err: any) {
      console.error("Resend error:", err);
      setError("Failed to resend code");
    } finally {
      setResending(false);
    }
  };

  return (
    <>
      <UnifiedTopNavBar />
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-black">
              Enter Verification Code
            </h2>
            <p className="mt-2 text-sm text-black">
              We sent a 6-digit code to
            </p>
            <p className="text-sm font-medium text-[#8B1C1C]">{email}</p>
          </div>

          <div className="bg-white shadow-xl rounded-lg p-8">
            <form onSubmit={handleVerify} className="space-y-6">
              <div>
                <div className="flex justify-center gap-2" onPaste={handlePaste}>
                  {code.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => {
                        inputRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleChange(index, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(index, e)}
                      className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-300 rounded-lg focus:border-[#8B1C1C] focus:ring-2 focus:ring-[#8B1C1C]/20 outline-none transition-all text-black"
                      disabled={loading}
                    />
                  ))}
                </div>
                {error && (
                  <p className="mt-3 text-sm text-red-600 text-center">{error}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || code.some((d) => !d)}
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-lg text-sm font-medium text-white bg-gradient-to-r from-[#8B1C1C] to-[#a83232] hover:from-[#7a1919] hover:to-[#8B1C1C] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#8B1C1C] disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02]"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Verifying...
                  </>
                ) : (
                  "Verify & Sign In"
                )}
              </button>

              <div className="text-center space-y-2">
                <p className="text-sm text-black">Didn't receive the code?</p>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="text-sm font-medium text-[#8B1C1C] hover:text-[#7a1919] disabled:opacity-50"
                >
                  {resending ? "Sending..." : "Resend Code"}
                </button>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    sessionStorage.removeItem("login_email");
                    sessionStorage.removeItem("login_password");
                    router.push("/login");
                  }}
                  className="text-sm text-black hover:text-black"
                >
                  ← Back to Login
                </button>
              </div>
            </form>
          </div>

          <div className="text-center text-xs text-black">
            <p>🔒 Your code will expire in 10 minutes</p>
          </div>
        </div>
      </div>
    </>
  );
}
