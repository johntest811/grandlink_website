"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

export default function ProfileSettingsPage() {
  const [loading, setLoading] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark" | "midnight">("light");

  const applyTheme = (nextTheme: "light" | "dark" | "midnight") => {
    try {
      localStorage.setItem("userTheme", nextTheme);
    } catch {
      // ignore localStorage errors
    }
    try {
      document.documentElement.dataset.userTheme = nextTheme;
      window.dispatchEvent(new Event("user-theme-changed"));
    } catch {
      // ignore document/window errors
    }
  };

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const preferred = data?.user?.user_metadata?.preferred_theme;
        if (preferred === "light" || preferred === "dark" || preferred === "midnight") {
          setTheme(preferred);
          applyTheme(preferred);
          return;
        }
      } catch {
        // ignore and fallback to local storage
      }

      try {
        const saved = localStorage.getItem("userTheme");
        if (saved === "light" || saved === "dark" || saved === "midnight") {
          setTheme(saved);
          applyTheme(saved);
        }
      } catch {
        // ignore
      }
    };

    loadTheme();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    setLoading(true);
    try {
      // Get current user email
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user?.email) {
        throw new Error("Unable to get current user email. Please sign in again.");
      }
      const email = userData.user.email;

      // Send password reset email
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/forgotpass/reset`,
      });
      if (error) {
        if (error.message.includes("For security purposes, you can only request this after")) {
          throw new Error(
            "You recently requested a password reset. Please wait before trying again."
          );
        }
        throw error;
      }

      setMessage(
        "A confirmation email was sent to your account. Open the email and follow the link to confirm and set your new password."
      );
    } catch (err: any) {
      setMessage(err?.message || "Failed to request password change.");
      console.error("request-password-change:", err);
    } finally {
      setLoading(false);
    }
  };

  const saveTheme = async () => {
    setMessage(null);
    setSavingTheme(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        throw new Error("Unable to load user account. Please sign in again.");
      }

      const { error } = await supabase.auth.updateUser({
        data: {
          ...(userData.user.user_metadata || {}),
          preferred_theme: theme,
        },
      });
      if (error) throw error;

      applyTheme(theme);
      setMessage("Theme preference saved to your account.");
    } catch (err: any) {
      setMessage(err?.message || "Failed to save theme.");
    } finally {
      setSavingTheme(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg w-full max-w-xl p-8 mx-auto mt-12 space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-3 text-[#8B1C1C]">Theme</h2>
        <p className="text-sm text-gray-600 mb-4">Choose the website profile theme you want to use.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={`p-4 rounded border text-left ${
              theme === "light" ? "bg-[#8B1C1C] text-white border-[#8B1C1C]" : "bg-white text-black"
            }`}
          >
            <div className="font-semibold">Light</div>
            <div className="text-xs opacity-80">Default light theme</div>
          </button>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={`p-4 rounded border text-left ${
              theme === "dark" ? "bg-[#8B1C1C] text-white border-[#8B1C1C]" : "bg-white text-black"
            }`}
          >
            <div className="font-semibold">Dark</div>
            <div className="text-xs opacity-80">Classic dark mode</div>
          </button>
          <button
            type="button"
            onClick={() => setTheme("midnight")}
            className={`p-4 rounded border text-left ${
              theme === "midnight" ? "bg-[#8B1C1C] text-white border-[#8B1C1C]" : "bg-white text-black"
            }`}
          >
            <div className="font-semibold">Midnight</div>
            <div className="text-xs opacity-80">Deep navy dark theme</div>
          </button>
        </div>
        <button
          type="button"
          onClick={saveTheme}
          disabled={savingTheme}
          className="bg-[#8B1C1C] text-white px-4 py-2 rounded font-semibold mt-4 hover:bg-[#a83232] transition disabled:opacity-60"
        >
          {savingTheme ? "Saving..." : "Save Theme"}
        </button>
      </div>

      <div className="border-t pt-6">
        <h2 className="text-2xl font-bold mb-6 text-[#8B1C1C]">Account Settings</h2>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <p className="text-sm text-gray-600">
            This will send a confirmation email to your account. After you click the link in the email, you will be able to set the new password.
          </p>
          <button
            type="submit"
            className="bg-[#8B1C1C] text-white px-4 py-2 rounded font-semibold mt-2 hover:bg-[#a83232] transition"
            disabled={loading}
          >
            {loading ? "Sending..." : "Send Confirmation Email"}
          </button>
        </form>
      </div>

      {message && <p className="text-sm mt-2">{message}</p>}
    </div>
  );
}