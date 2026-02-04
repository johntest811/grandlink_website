"use client";

import Image from "next/image";
import Link from "next/link";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import { FaUserCircle, FaMapMarkerAlt, FaBell, FaCog, FaQuestionCircle } from "react-icons/fa";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import React from "react";
import { useRouter } from "next/navigation";

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const pathname = usePathname() || "";
  const router = useRouter();
  useEffect(() => {
    try {
      if (localStorage.getItem("gl_pending_email_verification") === "1") {
        router.replace("/login/verify");
        return;
      }
    } catch {
      // ignore
    }

    const fetchUser = async () => {
      const { data } = await import("@/app/Clients/Supabase/SupabaseClients").then(mod => mod.supabase.auth.getUser());
      setUser(data?.user || null);
    };
    fetchUser();
  }, []);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    const confirmed = window.confirm("Are you sure you want to logout?");
    if (!confirmed) return;
    setIsLoggingOut(true);
    try {
      const { supabase } = await import("@/app/Clients/Supabase/SupabaseClients");
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn("Logout failed", error);
        alert(`Failed to logout: ${error.message}`);
        setIsLoggingOut(false);
        return;
      }
      setUser(null);
      router.push("/login");
    } catch (e: any) {
      console.warn("Logout error", e);
      alert("Something went wrong during logout. Please try again.");
      setIsLoggingOut(false);
    }
  };

  const menuItems = [
    { label: "Overview", href: "/profile" },
    { label: "Cart", href: "/profile/cart" },
    { label: "Wishlist", href: "/profile/my-list" },
    { label: "Reserve", href: "/profile/reserve" },
    { label: "Orders", href: "/profile/order" },
    { label: "Completed", href: "/profile/completed" },
    { label: "Cancelled", href: "/profile/cancelled" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <UnifiedTopNavBar />
      <main className="flex-1 flex flex-row">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r flex flex-col items-center py-8 px-4 min-h-screen">
          {/* Profile Section */}
          <div className="flex flex-col items-center mb-8 group">
            <div className="w-20 h-20 rounded-full border border-gray-300 flex items-center justify-center mb-2 bg-white overflow-hidden group-hover:border-[#8B1C1C] transition">
              {user?.user_metadata?.avatar_url ? (
                <Image
                  src={user.user_metadata.avatar_url}
                  alt="Profile"
                  width={80}
                  height={80}
                  className="rounded-full object-cover"
                />
              ) : (
                <span className="text-gray-300 text-lg">Profile</span>
              )}
            </div>
            <h2 className="text-base font-bold mt-2 text-gray-700 group-hover:text-[#8B1C1C] transition">
              {user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || "User"}
            </h2>
            {user?.email && (
              <span className="text-xs text-gray-500 mt-1">{user.email}</span>
            )}
            <button className="text-xs text-gray-500 hover:underline mt-1">Edit Profile</button>
          </div>
          {/* Sidebar Links */}
          <nav className="w-full flex flex-col gap-6">
            <Link href="/profile" className="flex items-center gap-2 text-gray-700 hover:text-[#8B1C1C] font-semibold">
              <FaUserCircle /> Profile
            </Link>
            <Link href="/profile/address" className="flex items-center gap-2 text-gray-700 hover:text-[#8B1C1C] font-semibold">
              <FaMapMarkerAlt /> My Address
            </Link>
            <Link href="/profile/notifications" className="flex items-center gap-2 text-gray-700 hover:text-[#8B1C1C] font-semibold">
              <FaBell /> Notification Settings
            </Link>
            <Link href="/profile/settings" className="flex items-center gap-2 text-gray-700 hover:text-[#8B1C1C] font-semibold">
              <FaCog /> Settings
            </Link>
            <Link href="/FAQs" className="flex items-center gap-2 text-gray-700 hover:text-[#8B1C1C] font-semibold">
              <span className="font-bold text-lg">!</span> FAQs
            </Link>
            {/* <Link href="#" className="flex items-center gap-2 text-gray-700 hover:text-[#8B1C1C] font-semibold">
              <FaQuestionCircle /> Help Centre
            </Link> */}
            <Link href="/Inquire" className="flex items-center gap-2 text-gray-700 hover:text-[#8B1C1C] font-semibold">
              <span className="font-bold text-lg">?</span> Inquire
            </Link>
          </nav>
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="bg-[#8B1C1C] text-white px-6 py-2 rounded font-semibold mt-10 w-full hover:bg-[#a83232] transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoggingOut ? "Logging out..." : "Logout"}
          </button>
        </aside>
        {/* Page Content */}
        <section className="flex-1 flex flex-col">
          {/* Tabs (shared for all profile sub-pages) */}
          <div className="px-8 py-6 border-b bg-gray-50">
            <nav className="flex gap-2">
              {menuItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-4 py-2 rounded ${
                    pathname === item.href ? "bg-[#8B1C1C] text-white" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex-1">
            {children}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}