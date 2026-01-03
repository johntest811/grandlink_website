"use client";
import { FaEnvelope, FaLock, FaUser, FaGoogle, FaCheckCircle } from "react-icons/fa";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { useState } from "react";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import { ReactNode } from "react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [popup, setPopup] = useState<{ success: boolean; message: ReactNode } | null>(null);
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://grandlnik-website.vercel.app");
  // Google OAuth registration
  const handleGoogleRegister = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${baseUrl}/home`,
      },
    });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    const passwordChecks = {
      length: password.length >= 8,
      lower: /[a-z]/.test(password),
      upper: /[A-Z]/.test(password),
      number: /\d/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    };
    const meetsMinimum =
      passwordChecks.length && passwordChecks.lower && passwordChecks.upper && passwordChecks.number;

    if (!meetsMinimum) {
      setPopup({
        success: false,
        message:
          "Password is too weak. Use 8+ characters with uppercase, lowercase, and a number (special character recommended).",
      });
      return;
    }

    if (password !== confirmPassword) {
      setPopup({ success: false, message: "Passwords do not match." });
      return;
    }
    // Pre-check if the email already exists in Supabase Auth
    try {
      const resp = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (resp.ok) {
        const j = await resp.json();
        if (j?.exists) {
          setPopup({ success: false, message: "This Gmail account already exists. Please log in instead." });
          return;
        }
      } else {
        // If the check fails, continue to sign up; Supabase will still enforce uniqueness.
        console.warn("check-email endpoint failed");
      }
    } catch (err) {
      console.warn("check-email request error", err);
      // Continue to sign up as a fallback.
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${baseUrl}/register/success`,
        data: { name }
      }
    });
    if (error) {
      // If Supabase returns a unique violation, present a friendly message
      const msg = (error.message || "").toLowerCase().includes("already registered") ||
                  (error.message || "").includes("duplicate")
        ? "This Gmail account already exists. Please log in instead."
        : "Registration failed: " + error.message;
      setPopup({ success: false, message: msg });
    } else {
      setPopup({
        success: true,
        message: (
          <div className="flex flex-col items-center justify-center">
            <FaCheckCircle className="text-green-500 mb-4" size={80} />
            <h2 className="text-2xl font-bold text-[#232d3b] text-center mb-2">Registration Confirmed!</h2>
            <p className="text-black text-center text-base mb-2">
              Please confirm your account creation.<br />
              A confirmation email has been sent to <span className="font-semibold text-[#8B1C1C]">{email}</span>.<br />
              You must click the <span className="font-semibold">"Register Account"</span> link in your Gmail inbox to activate your account.<br />
              If you do not confirm within a certain time, the link will expire and become invalid.
            </p>
          </div>
        )
      });
      setName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
    }
  };

  const passwordChecks = {
    length: password.length >= 8,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };

  const strengthScore =
    Number(passwordChecks.length) +
    Number(passwordChecks.lower) +
    Number(passwordChecks.upper) +
    Number(passwordChecks.number) +
    Number(passwordChecks.special);

  const strengthLabel =
    strengthScore <= 2 ? "Weak" : strengthScore <= 4 ? "Medium" : "Strong";

  const strengthColorClass =
    strengthLabel === "Strong" ? "text-green-600" : strengthLabel === "Medium" ? "text-yellow-600" : "text-red-600";

  const meetsMinimumStrength =
    passwordChecks.length && passwordChecks.lower && passwordChecks.upper && passwordChecks.number;

  const passwordsMatch =
    confirmPassword.length === 0 ? true : password === confirmPassword;

  return (
    <div
      className="relative min-h-screen font-sans bg-cover bg-center flex flex-col"
      style={{ backgroundImage: 'url("/sevices.avif")' }}
    >
      <UnifiedTopNavBar />
      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center">
        <div className="bg-white/95 rounded-xl shadow-lg px-8 py-10 w-full max-w-md flex flex-col items-center relative z-10 mt-12 mb-12">
          <h1 className="text-3xl font-bold text-center mb-6 text-[#8B1C1C]">Register</h1>
          <form className="w-full flex flex-col gap-4" onSubmit={handleRegister}>
            <div>
              <label className="font-semibold text-sm mb-1 block text-black" htmlFor="name">
                Full Name
              </label>
              <div className="flex items-center border border-gray-400 rounded-lg px-3 py-2 bg-gray-100">
                <FaUser className="text-gray-500 mr-2" />
                <input
                  id="name"
                  type="text"
                  placeholder="Please Enter your Full Name"
                  className="bg-transparent outline-none flex-1 text-gray-700 placeholder-gray-400"
                  autoComplete="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="font-semibold text-sm mb-1 block text-black" htmlFor="email">
                Gmail
              </label>
              <div className="flex items-center border border-gray-400 rounded-lg px-3 py-2 bg-gray-100">
                <FaEnvelope className="text-gray-500 mr-2" />
                <input
                  id="email"
                  type="email"
                  placeholder="Please Enter your Gmail Address"
                  className="bg-transparent outline-none flex-1 text-gray-700 placeholder-gray-400"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="font-semibold text-sm mb-1 block text-black" htmlFor="password">
                Password
              </label>
              <div className="flex items-center border border-gray-400 rounded-lg px-3 py-2 bg-gray-100">
                <FaLock className="text-gray-500 mr-2" />
                <input
                  id="password"
                  type="password"
                  placeholder="Please Enter your password"
                  className="bg-transparent outline-none flex-1 text-gray-700 placeholder-gray-400"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
              <div className="mt-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-black">Password strength:</span>
                  <span className={`font-semibold ${strengthColorClass}`}>{strengthLabel}</span>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-1 text-black">
                  <div className={passwordChecks.length ? "text-green-600" : "text-red-600"}>
                    {passwordChecks.length ? "OK" : "X"} 8+ characters
                  </div>
                  <div className={passwordChecks.upper ? "text-green-600" : "text-red-600"}>
                    {passwordChecks.upper ? "OK" : "X"} uppercase letter
                  </div>
                  <div className={passwordChecks.lower ? "text-green-600" : "text-red-600"}>
                    {passwordChecks.lower ? "OK" : "X"} lowercase letter
                  </div>
                  <div className={passwordChecks.number ? "text-green-600" : "text-red-600"}>
                    {passwordChecks.number ? "OK" : "X"} number
                  </div>
                  <div className={passwordChecks.special ? "text-green-600" : "text-gray-600"}>
                    {passwordChecks.special ? "OK" : "Optional"} special character
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label className="font-semibold text-sm mb-1 block text-black" htmlFor="confirm-password">
                Confirm Password
              </label>
              <div className="flex items-center border border-gray-400 rounded-lg px-3 py-2 bg-gray-100">
                <FaLock className="text-gray-500 mr-2" />
                <input
                  id="confirm-password"
                  type="password"
                  placeholder="Confirm your password"
                  className="bg-transparent outline-none flex-1 text-gray-700 placeholder-gray-400"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                />
              </div>
              {!passwordsMatch ? (
                <div className="mt-2 text-xs text-red-600">Passwords do not match.</div>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={!meetsMinimumStrength || !passwordsMatch}
              className={`bg-[#232d3b] text-white font-semibold rounded w-full py-2 mt-2 transition ${
                !meetsMinimumStrength || !passwordsMatch ? "opacity-60 cursor-not-allowed" : "hover:bg-[#1a222e]"
              }`}
            >
              REGISTER
            </button>
          </form>
          <button
            type="button"
            onClick={handleGoogleRegister}
            className="flex items-center gap-2 bg-gray-100 border border-gray-300 rounded px-4 py-2 mt-4 w-full justify-center hover:bg-gray-200 transition"
          >
            <FaGoogle className="text-[#4285F4] text-xl" />
            <span className="font-medium text-gray-700">Sign up with Google</span>
          </button>
          <div className="text-xs text-center mt-4 text-gray-600">
            Already have an account?{" "}
            <a href="login" className="text-blue-600 hover:underline">
              Login
            </a>
          </div>
          {/* Popup for success or failure */}
          {popup && (
            <div className={`fixed inset-0 flex items-center justify-center z-50 bg-transparent`}>
              <div className={`bg-white rounded-lg shadow-lg p-8 min-w-[350px] text-center flex flex-col items-center`}>
                {popup.success ? popup.message : (
                  <>
                    <h2 className="text-xl font-bold mb-2 text-red-600">Error</h2>
                    <p className="mb-4 text-black">{popup.message}</p>
                  </>
                )}
                <button
                  className="bg-[#232d3b] text-white px-4 py-2 rounded hover:bg-[#1a222e] transition mt-4"
                  onClick={() => setPopup(null)}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      {/* Optional: Overlay for background dimming */}
      <div className="absolute inset-0 bg-black/30 -z-0" aria-hidden="true"></div>
    </div>
  );
}
