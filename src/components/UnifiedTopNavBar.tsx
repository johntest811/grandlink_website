"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { FaBell, FaChevronDown, FaEnvelope, FaPhone, FaThumbsUp, FaUserCircle, FaShoppingCart } from "react-icons/fa";
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

export default function UnifiedTopNavBar() {
  const [user, setUser] = useState<any>(null);
  const getPendingVerification = () => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("gl_pending_email_verification") === "1";
    } catch {
      return false;
    }
  };

  const [pendingVerification, setPendingVerification] = useState<boolean>(() => getPendingVerification());
  const [notifications, setNotifications] = useState<UserNotif[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [cartCount, setCartCount] = useState<number>(0);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [hoveredDropdown, setHoveredDropdown] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [navShellHeight, setNavShellHeight] = useState(0);
  const lastScrollYRef = useRef(0);
  const navShellRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const measure = () => {
      if (!navShellRef.current) return;
      setNavShellHeight(navShellRef.current.offsetHeight);
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const currentScrollY = window.scrollY;
      const nearTop = currentScrollY < 80;
      if (nearTop) {
        setIsNavVisible(true);
      } else {
        setIsNavVisible(currentScrollY < lastScrollYRef.current);
      }
      lastScrollYRef.current = currentScrollY;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sync = () => {
      const nextPending = getPendingVerification();
      setPendingVerification(nextPending);
      if (nextPending) setUser(null);
    };

    // Keep state in sync for same-tab writes + cross-tab storage events
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "gl_pending_email_verification") sync();
    };
    const onCustom = () => sync();

    window.addEventListener("storage", onStorage);
    window.addEventListener("gl:pendingVerificationChanged", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("gl:pendingVerificationChanged", onCustom as EventListener);
    };
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      if (pendingVerification) {
        setUser(null);
        return;
      }
      const { data } = await supabase.auth.getUser();
      setUser(data?.user || null);
    };
    fetchUser();
  }, [pendingVerification]);

  useEffect(() => {
    if (user?.id) fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Load cart count and subscribe to cart changes for this user
  useEffect(() => {
    if (!user?.id) {
      setCartCount(0);
      return;
    }

    let isMounted = true;

    const loadCount = async () => {
      const { count } = await supabase
        .from("cart")
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (isMounted) setCartCount(count || 0);
    };

    loadCount();

    const channel = supabase
      .channel(`cart-count-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cart', filter: `user_id=eq.${user.id}` },
        () => loadCount()
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

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

  const toggleNotif = () => setNotifOpen((prev) => !prev);

  const markAsRead = async (id: number) => {
    const { error } = await supabase
      .from("user_notifications")
      .update({ is_read: true })
      .eq("id", id);
      
    if (!error) {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    }
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    
    const { error } = await supabase
      .from("user_notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
      
    if (!error) {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setShowConfirm(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeDropdown]);

  const getNavBottom = () => {
    if (!navRef.current) return 100;
    const rect = navRef.current.getBoundingClientRect();
    return rect.bottom;
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'new_product': return '🎉';
      case 'stock_update': return '📦';
      case 'order_status': return '📋';
      case 'payment_request': return '💰';
      default: return '🔔';
    }
  };

  const parseMetadata = (metadata: any) => {
    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata);
      } catch {
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

  const handleProfileClick = () => {
    if (!user) {
      if (window.confirm("Please log in to access your profile. Would you like to go to the login page?")) {
        router.push("/login");
      }
    } else {
      router.push("/profile");
    }
  };

  return (
    <>
      <div
        ref={navShellRef}
        className={`fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ease-out ${
          isNavVisible ? "translate-y-0" : "-translate-y-full"
        }`}
      >
      {/* Main Navigation */}
      <header className="w-full bg-white flex flex-col sm:flex-row items-center justify-between px-4 py-2 shadow z-20 relative">
        <div className="flex items-center gap-2 mb-3 mt-3">
          <Link href={user ? "/home" : "/"}>
            <Image src="/ge-logo.avif" alt="Grand East Logo" width={170} height={170} />
          </Link>
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
          <Link href="/blogs" className="text-gray-700 hover:text-[#8B1C1C] font-medium">Blogs</Link>
        </nav>
        
        <div className="flex items-center gap-4">
          <Link href="/Inquire">
            <button className="bg-[#8B1C1C] text-white px-4 py-2 rounded font-semibold hover:bg-[#a83232] transition">
              INQUIRE NOW
            </button>
          </Link>

          {/* Cart button */}
          <button
            onClick={() => router.push('/profile/cart')}
            title="Cart"
            className="relative p-2 rounded hover:bg-gray-100 transition"
            aria-label="Cart"
          >
            <FaShoppingCart className={`text-xl ${cartCount > 0 ? 'text-[#8B1C1C]' : 'text-gray-700'}`} />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#8B1C1C] text-white text-[10px] flex items-center justify-center">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </button>

          {/* Show notifications only for logged-in users */}
          {user && (
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
                <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border z-50 max-h-[500px] overflow-hidden">
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
                                  <p className="text-xs text-gray-600 mt-1">{n.message}</p>
                                  {describeNotification(n) && (
                                    <p className="text-xs text-[#8B1C1C] mt-1">{describeNotification(n)}</p>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Profile/Login Button */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 p-2 rounded hover:bg-gray-100 transition"
            >
              {user?.user_metadata?.avatar_url ? (
                <img 
                  src={user.user_metadata.avatar_url} 
                  alt="Profile" 
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <FaUserCircle className="text-2xl text-gray-700" />
              )}
              {user && <FaChevronDown className="text-xs text-gray-700" />}
            </button>

            {open && user && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl border z-50">
                <div className="px-4 py-4 border-b bg-gray-50 flex items-center gap-3">
                  {user?.user_metadata?.avatar_url ? (
                    <img 
                      src={user.user_metadata.avatar_url} 
                      alt="Profile" 
                      className="w-12 h-12 rounded-full object-cover border-2 border-gray-200"
                    />
                  ) : (
                    <FaUserCircle className="text-4xl text-gray-400" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || "User"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{user.email || user.user_metadata?.email || ""}</p>
                    <p className="text-[10px] text-green-600 mt-0.5">● Logged in</p>
                  </div>
                </div>
                <ul className="py-2">
                  <li>
                    <button
                      onClick={() => {
                        router.push("/profile");
                        closeDropdown();
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 text-gray-700"
                    >
                      My Profile
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => setShowConfirm(true)}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 text-red-600"
                    >
                      Logout
                    </button>
                  </li>
                </ul>

                {showConfirm && (
                  <div className="border-t p-3 bg-gray-50">
                    <p className="text-xs text-gray-600 mb-2">
                      Are you sure you want to log out?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          handleLogout();
                          closeDropdown();
                        }}
                        className="flex-1 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                      >
                        Yes, Logout
                      </button>
                      <button
                        onClick={() => setShowConfirm(false)}
                        className="flex-1 px-3 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {open && !user && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl border z-50">
                <div className="px-4 py-4 border-b bg-gray-50 flex items-center gap-3">
                  <FaUserCircle className="text-4xl text-gray-400" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">Guest User</p>
                    <p className="text-xs text-gray-500">Not logged in</p>
                  </div>
                </div>
                <ul className="py-2">
                  <li>
                    <button
                      onClick={() => {
                        router.push("/login");
                        closeDropdown();
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 text-gray-700"
                    >
                      Login
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => {
                        router.push("/register");
                        closeDropdown();
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 text-gray-700"
                    >
                      Register
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
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
          <FaPhone className="text-base" /> Smart | 09082810586 Globe (Viber) | 09277640475
        </div>
      </div>
      </div>

      <div aria-hidden="true" style={{ height: navShellHeight || 116 }} />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-20 right-4 z-50 bg-white rounded-lg shadow-xl border-l-4 border-[#8B1C1C] p-4 max-w-sm animate-slide-in">
          <div className="flex items-start gap-3">
            <div className="text-2xl">🔔</div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">{toast.title}</p>
              <p className="text-sm text-gray-600 mt-1">{toast.message}</p>
            </div>
            <button
              onClick={() => setToast(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
