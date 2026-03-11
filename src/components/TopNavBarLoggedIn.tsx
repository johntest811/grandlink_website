"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { FaBell, FaChevronDown, FaEnvelope, FaPhone, FaThumbsUp, FaUserCircle } from "react-icons/fa";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type UserNotif = {
  id: number;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  action_url?: string | null;
  type: 'new_product' | 'stock_update' | 'order_status' | 'payment_request' | string;
  metadata?: Record<string, any> | string | null;
};

export default function TopNavBarLoggedIn() {
  const [user, setUser] = useState<any>(null);
  const [notifications, setNotifications] = useState<UserNotif[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [hoveredDropdown, setHoveredDropdown] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user || null);
    };
    fetchUser();
  }, []);

  useEffect(() => {
    if (user?.id) fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Realtime subscription for user notifications
  useEffect(() => {
    if (!user?.id) return;
    
    const sub = supabase
      .channel(`user-notifications-${user.id}`)
      .on(
        "postgres_changes",
        { 
          event: "INSERT", 
          schema: "public", 
          table: "user_notifications", 
          filter: `user_id=eq.${user.id}` 
        },
        (payload) => {
          const newNotif = (payload as any).new;
          if (!newNotif) return;
          
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((c) => c + 1);
          setToast({ title: newNotif.title, message: newNotif.message });
          
          // Auto-hide toast after 5 seconds
          setTimeout(() => setToast(null), 5000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [user?.id]);

  // Fetch user notifications
  async function fetchNotifications() {
    if (!user?.id) return;
    
    const { data, error } = await supabase
      .from("user_notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
      
    if (error) {
      console.error("fetch notifications error", error);
      return;
    }
    
    setNotifications(data ?? []);
    setUnreadCount((data ?? []).filter((n: any) => !n.is_read).length);
  }

  // Mark a single notification as read
  async function markAsRead(id: number) {
    if (!user?.id) return;
    
    const { error } = await supabase
      .from("user_notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", user.id);
      
    if (error) {
      console.error("mark read error", error);
    }
    
    fetchNotifications();
  }

  // Mark all notifications as read
  async function markAllRead() {
    if (!user?.id) return;
    
    const { error } = await supabase
      .from("user_notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
      
    if (error) {
      console.error("mark all read error", error);
    }
    
    fetchNotifications();
  }

  // Toggle notifications dropdown
  const toggleNotif = useCallback(() => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) fetchNotifications();
  }, [notifOpen]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
        setShowConfirm(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Helper to get nav bar bottom position for dropdown
  const getNavBottom = () => {
    if (navRef.current) {
      const rect = navRef.current.getBoundingClientRect();
      return rect.bottom;
    }
    return 60; // fallback
  };

  const handleLogout = () => {
    setShowConfirm(true);
  };

  const confirmLogout = () => {
    setShowConfirm(false);
    setOpen(false);
    router.push("/login");
  };

  // Get notification icon based on type
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'new_product':
        return '🆕';
      case 'stock_update':
        return '📦';
      case 'order_status':
        return '📋';
      case 'payment_request':
        return '💳';
      default:
        return '🔔';
    }
  };

  const parseMetadata = (metadata: any) => {
    if (!metadata) return null;
    if (typeof metadata === "string") {
      try {
        return JSON.parse(metadata);
      } catch (error) {
        console.warn("Failed to parse notification metadata", error);
        return null;
      }
    }
    return metadata;
  };

  const describeNotification = (notification: any) => {
    const meta = parseMetadata(notification.metadata);
    if (!meta) return null;

    if (notification.type === 'stock_update' && typeof meta.new_stock !== 'undefined') {
      return `New stock level: ${meta.new_stock}`;
    }

    if (notification.type === 'order_status' && meta.new_status) {
      const status = String(meta.new_status).replace(/_/g, ' ').toUpperCase();
      return `Status updated to ${status}`;
    }

    if (notification.type === 'new_product' && meta.product_name) {
      return `Featuring ${meta.product_name}`;
    }

    if (notification.type === 'payment_request' && meta.balance_amount_due) {
      return `Requested amount: ₱${Number(meta.balance_amount_due).toLocaleString()}`;
    }

    return null;
  };

  return (
    <>
      {/* Main Navigation */}
      <header className="w-full bg-white flex flex-col sm:flex-row items-center justify-between px-4 py-2 shadow z-20 relative">
        <div className="flex items-center gap-2 mb-3 mt-3">
          <Image src="/ge-logo.avif" alt="Grand East Logo" width={170} height={170} />
        </div>
        
        <nav ref={navRef} className="flex-1 flex justify-center items-center gap-8 ml-8 relative z-30">
          <Link href="/home" className="text-gray-700 hover:text-[#8B1C1C] font-medium">Home</Link>
          
          {/* About Us Dropdown */}
          <div
            className="relative group"
            onMouseEnter={() => setHoveredDropdown("about")}
            onMouseLeave={() => setHoveredDropdown(null)}
          >
            <Link
              href="/about-us"
              className="flex items-center gap-1 text-gray-700 hover:text-[#8B1C1C] font-medium"
            >
              About Us <FaChevronDown className="text-xs mt-1" />
            </Link>
            {hoveredDropdown === "about" && (
              <div
                className="fixed left-auto bg-white shadow rounded z-50 min-w-[180px]"
                style={{
                  top: getNavBottom(),
                  left: navRef.current
                    ? navRef.current.querySelectorAll("a")[1]?.getBoundingClientRect().left
                    : 200,
                }}
              >
                <Link href="/showroom" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Showroom</Link>
              </div>
            )}
          </div>

          {/* Services We Offer Dropdown */}
          <div
            className="relative group"
            onMouseEnter={() => setHoveredDropdown("services")}
            onMouseLeave={() => setHoveredDropdown(null)}
          >
            <Link
              href="/services"
              className="flex items-center gap-1 text-gray-700 hover:text-[#8B1C1C] font-medium"
            >
              Services We Offer <FaChevronDown className="text-xs mt-1" />
            </Link>
            {hoveredDropdown === "services" && (
              <div
                className="fixed left-auto bg-white shadow rounded z-50 min-w-[220px]"
                style={{
                  top: getNavBottom(),
                  left: navRef.current
                    ? navRef.current.querySelectorAll("a")[2]?.getBoundingClientRect().left
                    : 350,
                }}
              >
                <Link href="/Featured" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Featured Projects</Link>
                <Link href="/DeliveryProcess" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Delivery & Ordering Process</Link>
              </div>
            )}
          </div>

          {/* Products Dropdown */}
          <div
            className="relative group"
            onMouseEnter={() => setHoveredDropdown("products")}
            onMouseLeave={() => setHoveredDropdown(null)}
          >
            <Link
              href="/Product"
              className="flex items-center gap-1 text-gray-700 hover:text-[#8B1C1C] font-medium"
            >
              Products <FaChevronDown className="text-xs mt-1" />
            </Link>
            {hoveredDropdown === "products" && (
              <div
                className="fixed left-auto bg-white shadow rounded z-50 min-w-[200px]"
                style={{
                  top: getNavBottom(),
                  left: navRef.current
                    ? navRef.current.querySelectorAll("a")[3]?.getBoundingClientRect().left
                    : 500,
                }}
              >
                <Link href="/Product?category=Doors" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Doors</Link>
                <Link href="/Product?category=Enclosure" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Enclosures</Link>
                <Link href="/Product?category=Windows" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Windows</Link>
                <Link href="/Product?category=Railings" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Railings</Link>
                <Link href="/Product?category=Canopy" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Canopy</Link>
                <Link href="/Product?category=Curtain Wall" className="block px-4 py-2 hover:bg-gray-100 text-gray-700">Curtain Wall</Link>
              </div>
            )}
          </div>

          <Link href="/FAQs" className="text-gray-700 hover:text-[#8B1C1C] font-medium">FAQs</Link>
        </nav>
        
        <div className="flex items-center gap-4">
          <Link href="/Inquire">
            <button className="bg-[#8B1C1C] text-white px-4 py-2 rounded font-semibold hover:bg-[#a83232] transition">
              INQUIRE NOW
            </button>
          </Link>

          {/* Enhanced Notification Bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={toggleNotif}
              title="Notifications"
              className={`relative p-2 rounded transition ${notifOpen ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
              aria-haspopup="true"
              aria-expanded={notifOpen}
            >
              <FaBell className={`text-xl ${unreadCount > 0 ? 'text-[#8B1C1C]' : 'text-gray-700'}`} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#8B1C1C] text-white text-[10px] flex items-center justify-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-[calc(100vw-1rem)] max-w-sm sm:w-96 bg-white rounded-lg shadow-xl border z-50 max-h-[min(70vh,500px)] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="text-xs bg-[#8B1C1C] text-white rounded-full px-2 py-0.5">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-xs text-[#8B1C1C] hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-auto">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">No notifications yet</div>
                  ) : (
                    <ul className="divide-y">
                      {notifications.map((n) => {
                        const meta = parseMetadata(n.metadata);
                        const icon = getNotificationIcon(n.type);
                        return (
                          <li
                            key={n.id}
                            className={`p-3 hover:bg-gray-50 cursor-pointer ${!n.is_read ? 'bg-blue-50' : ''}`}
                            onClick={() => {
                              if (!n.is_read) markAsRead(n.id);
                              if (n.action_url) router.push(n.action_url);
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100">{icon}</div>
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-medium text-gray-900">{n.title}</p>
                                  <span className="text-[10px] text-gray-500">
                                    {new Date(n.created_at).toLocaleString()}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-700 line-clamp-2">{n.message}</p>
                                {describeNotification(n) && (
                                  <p className="text-[11px] text-gray-500 mt-1">{describeNotification(n)}</p>
                                )}
                              </div>
                              {!n.is_read && <span className="w-2 h-2 bg-[#8B1C1C] rounded-full mt-2" />}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="p-3 text-center border-top bg-gray-50">
                  <Link
                    href="/profile/notifications"
                    className="text-sm text-[#8B1C1C] hover:underline"
                    onClick={() => setNotifOpen(false)}
                  >
                    View all notifications
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* User Profile Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <div
              className="flex items-center gap-2 cursor-pointer group"
              onMouseEnter={() => setOpen(true)}
              onClick={() => setOpen((prev) => !prev)}
            >
              {user?.user_metadata?.avatar_url ? (
                <Image
                  src={user.user_metadata.avatar_url}
                  alt="Profile"
                  width={40}
                  height={40}
                  className="rounded-full border border-gray-300 group-hover:border-[#8B1C1C] transition"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-700 group-hover:text-[#8B1C1C] border border-gray-300 group-hover:border-[#8B1C1C] transition">
                  {user?.email ? user.email[0].toUpperCase() : <FaUserCircle />}
                </div>
              )}
              {user?.email && (
                <span className="text-sm font-medium text-gray-700 group-hover:text-[#8B1C1C] transition">{user.email}</span>
              )}
            </div>
            
            {open && (
              <div
                className="absolute right-0 mt-2 w-40 bg-white rounded shadow-lg border z-50"
                onMouseLeave={() => setOpen(false)}
              >
                <button
                  className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-gray-800"
                  onClick={() => {
                    setOpen(false);
                    router.push("/profile");
                  }}
                >
                  Profile
                </button>
                <button
                  className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-gray-800"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            )}
            
            {showConfirm && (
              <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
                <div className="bg-white rounded-lg shadow-lg p-6 w-80">
                  <h3 className="text-black font-semibold mb-4">Confirm Logout</h3>
                  <p className="mb-6 text-gray-700">Are you sure you want to logout?</p>
                  <div className="flex justify-end gap-3">
                    <button
                      className="px-4 py-2 rounded bg-gray-200 text-gray-800 hover:bg-gray-300"
                      onClick={() => setShowConfirm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
                      onClick={confirmLogout}
                    >
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Enhanced Toast popup for live notifications */}
        {toast && (
          <div className="fixed top-20 left-4 right-4 sm:left-auto sm:right-6 z-50 animate-slide-in">
            <div className="bg-white shadow-xl border-l-4 border-l-blue-500 px-4 py-3 rounded-lg w-full max-w-sm">
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-50">🔔</div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
                  <p className="text-xs text-gray-700">{toast.message}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Contact Bar */}
      <div className="w-full bg-[#232d3b] text-white flex flex-col sm:flex-row items-center justify-center gap-4 py-2 px-2 text-xs sm:text-sm z-10">
        <div className="flex items-center gap-1">
          <FaEnvelope className="text-base" /> grandeast.org@gmail.com
        </div>
        <span className="hidden sm:inline">|</span>
        <div className="flex items-center gap-1">
          <FaThumbsUp className="text-base" /> Click here visit to our FB Page
        </div>
        <span className="hidden sm:inline">|</span>
        <div className="flex items-center gap-1">
          <FaPhone className="text-base" /> Smart || 09082810586 Globe (Viber) || 09277640475
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </>
  );
}