"use client";

import { useState } from "react";
import { FaEnvelope, FaLock, FaGoogle } from "react-icons/fa";
import Image from "next/image";
import TopNavBar from "@/components/TopNavBar";
import { useRouter } from "next/navigation";
import { supabase } from "../Clients/Supabase/SupabaseClients";
import LoadingSuccess from "./LoadingSuccess";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [sending, setSending] = useState(false);
  const router = useRouter();

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://grandlnik-website.vercel.app");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return; // prevent double submit
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/request-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to start login");
        setSending(false);
        return;
      }
      // Store credentials temporarily so /login/verify can complete sign-in after code verification
      sessionStorage.setItem("login_email", email);
      sessionStorage.setItem("login_password", password);
      sessionStorage.setItem("login_flow", "password");

      router.push("/login/verify");
    } catch (e: any) {
      setError("Failed to start login");
      setSending(false);
    }
  };

  const sendConfirmationEmail = async (email: string) => {
    // This sends a magic link to the user's email
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: "https://grandlnik-website.vercel.app/login"
      }
    });
    return error;
  };

  const handleSendConfirmation = async () => {
    const error = await sendConfirmationEmail(email);
    if (!error) {
      setConfirmationSent(true);
    } else {
      setError("Failed to send confirmation email.");
    }
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // After Google OAuth completes, we still require a verification code.
        redirectTo: `${baseUrl}/login/confirm`,
      },
    });
  };

  if (showSuccess) {
    return <LoadingSuccess />;
  }

  return (
    <div className="relative min-h-screen font-sans bg-cover bg-center flex flex-col" style={{ backgroundImage: 'url("/sevices.avif")' }}>
      <TopNavBar />
      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center">
        <div className="bg-white/95 rounded-xl shadow-lg px-8 py-10 w-full max-w-md flex flex-col items-center relative z-10">
          <h1 className="text-3xl font-bold text-center mb-6 text-[#8B1C1C]">Login</h1>
          <form className="w-full flex flex-col gap-4" onSubmit={handleLogin}>
            <div>
              <label className="font-semibold text-sm mb-1 block text-black" htmlFor="email">Gmail</label>
              <div className="flex items-center border border-gray-400 rounded-lg px-3 py-2 bg-gray-100">
                <FaEnvelope className="text-gray-500 mr-2" />
                <input
                  id="email"
                  type="email"
                  placeholder="Please Enter your Gmail Address"
                  className="bg-transparent outline-none flex-1 text-gray-700 placeholder-gray-400"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <label className="font-semibold text-sm mb-1 block text-black" htmlFor="password">Password</label>
              <div className="flex items-center border border-gray-400 rounded-lg px-3 py-2 bg-gray-100">
                <FaLock className="text-gray-500 mr-2" />
                <input
                  id="password"
                  type="password"
                  placeholder="Please Enter your password"
                  className="bg-transparent outline-none flex-1 text-gray-700 placeholder-gray-400"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="flex justify-end text-xs">
              <a href="forgotpass" className="text-blue-600 hover:underline">Forgot Password</a>
            </div>
            <button type="submit" disabled={sending} className={`bg-[#232d3b] text-white font-semibold rounded w-full py-2 mt-2 transition ${sending ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[#1a222e]'}`}>{sending ? 'Sending link…' : 'LOGIN'}</button>
            {error && (
              <div className="text-red-600 text-xs text-center mt-2">{error}</div>
            )}
          </form>
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="flex items-center gap-2 bg-gray-100 border border-gray-300 rounded px-4 py-2 mt-4 w-full justify-center hover:bg-gray-200 transition"
          >
            <FaGoogle className="text-[#4285F4] text-xl" />
            <span className="font-medium text-gray-700">Sign in with Google</span>
          </button>
          <div className="text-xs text-center mt-4 text-gray-600">
            Don’t have an account yet? <a href="register" className="text-blue-600 hover:underline">Sign Up</a>
          </div>
          {error === "Please confirm your Gmail address before logging in. Check your inbox for the confirmation email." && (
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded mt-4"
              onClick={handleSendConfirmation}
              disabled={confirmationSent}
            >
              {confirmationSent ? "Confirmation Sent!" : "Resend Confirmation Email"}
            </button>
          )}
        </div>
      </main>
      {/* Optional: Overlay for background dimming */}
      <div className="absolute inset-0 bg-black/30 -z-0" aria-hidden="true"></div>
    </div>
  );
}