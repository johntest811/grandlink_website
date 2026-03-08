"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type ChatMessage = {
  id: string;
  created_at: string;
  sender_type: "visitor" | "user" | "admin";
  sender_name?: string | null;
  body?: string | null;
  image_url?: string | null;
};

type ThreadInfo = {
  id: string;
  status: "pending" | "active" | "resolved";
  accepted_at?: string | null;
  resolved_at?: string | null;
};

const LS_TOKEN = "gl_chat_token";
const LS_NAME = "gl_chat_name";
const LS_EMAIL = "gl_chat_email";

type FaqItem = {
  id: string;
  question: string;
  answer: string;
  quickMessage: string;
  categoryId?: string;
  categoryName?: string;
};

type FAQCategory = {
  id: number;
  name: string;
  faq_questions: {
    id: number;
    question: string;
    answer: string;
  }[];
};

const FALLBACK_CHAT_FAQS: FaqItem[] = [
  {
    id: "driver-software",
    question: "Driver software download",
    answer: "Please send your unit model and operating system so our team can provide the correct driver link.",
    quickMessage: "Hi, I need help with driver software download.",
  },
  {
    id: "track-order",
    question: "Track my order",
    answer: "Share your order number and full name, then we will check your latest order status for you.",
    quickMessage: "Hi, can you help me track my order?",
  },
  {
    id: "modify-order",
    question: "How can I modify my order?",
    answer: "Order changes depend on processing stage. Send your order number so we can verify if edits are still possible.",
    quickMessage: "Hi, I want to modify my order details.",
  },
  {
    id: "change-address",
    question: "How to change my address?",
    answer: "You can update saved addresses from your profile, then message us with your order number for delivery address changes.",
    quickMessage: "Hi, I need to change my delivery address.",
  },
  {
    id: "shipping-handling",
    question: "Shipping & Handling",
    answer: "Shipping schedule and handling depend on your location and item type. Message us your area to get an estimate.",
    quickMessage: "Hi, I have a question about shipping and handling.",
  },
  {
    id: "shipping-cost",
    question: "How much does shipping cost?",
    answer: "Shipping fees vary by delivery address and order size. Share your location and item list for a quote.",
    quickMessage: "Hi, how much will shipping cost for my order?",
  },
];

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string>("");
  const [thread, setThread] = useState<ThreadInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const [startName, setStartName] = useState("");
  const [startEmail, setStartEmail] = useState("");

  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activeFaqId, setActiveFaqId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"faq" | "chat">("faq");
  const [faqCategories, setFaqCategories] = useState<FAQCategory[]>([]);
  const [activeFaqCategoryId, setActiveFaqCategoryId] = useState<string | null>(null);
  const [faqSearch, setFaqSearch] = useState("");

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const [userInfo, setUserInfo] = useState<{ id: string; email?: string; name?: string } | null>(null);

  const faqItems = useMemo<FaqItem[]>(() => {
    if (!faqCategories.length) return FALLBACK_CHAT_FAQS;

    return faqCategories.flatMap((category) =>
      category.faq_questions.map((faq) => ({
        id: `${category.id}-${faq.id}`,
        categoryId: String(category.id),
        categoryName: category.name,
        question: faq.question,
        answer: faq.answer,
        quickMessage: `Hi, I need help with: ${faq.question}`,
      }))
    );
  }, [faqCategories]);

  const faqCategoryOptions = useMemo(() => {
    if (!faqCategories.length) {
      return [{ id: "general", name: "General" }];
    }
    return faqCategories.map((category) => ({ id: String(category.id), name: category.name }));
  }, [faqCategories]);

  const filteredFaqItems = useMemo(() => {
    const query = faqSearch.trim().toLowerCase();
    if (query) {
      return faqItems.filter((faq) => `${faq.question} ${faq.answer}`.toLowerCase().includes(query));
    }

    if (!activeFaqCategoryId || activeFaqCategoryId === "general") {
      return faqItems;
    }

    return faqItems.filter((faq) => faq.categoryId === activeFaqCategoryId);
  }, [activeFaqCategoryId, faqItems, faqSearch]);

  const featuredFaqItems = useMemo(() => filteredFaqItems.slice(0, 8), [filteredFaqItems]);

  const canSend = useMemo(() => {
    if (!thread) return false;
    if (thread.status === "resolved") return false;
    // Visitors/users can send while pending; admin replies after accept.
    return true;
  }, [thread]);

  useEffect(() => {
    const fetchFaqs = async () => {
      const { data, error } = await supabase
        .from("faq_categories")
        .select(`
          id,
          name,
          faq_questions (
            id,
            question,
            answer
          )
        `)
        .order("id", { ascending: true });

      if (!error && data) {
        setFaqCategories(data as FAQCategory[]);
        if (data.length > 0) {
          setActiveFaqCategoryId(String(data[0].id));
        }
      }
    };

    fetchFaqs().catch(() => undefined);

    // Load persisted guest info/token
    try {
      setToken(localStorage.getItem(LS_TOKEN) || "");
      setStartName(localStorage.getItem(LS_NAME) || "");
      setStartEmail(localStorage.getItem(LS_EMAIL) || "");
    } catch {
      // ignore
    }

    // Try to detect logged-in user
    supabase.auth
      .getUser()
      .then(({ data }) => {
        const u = data?.user;
        if (!u) return;

        const meta = (u.user_metadata || {}) as Record<string, unknown>;
        const metaFullName = typeof meta.full_name === "string" ? meta.full_name : undefined;
        const metaName = typeof meta.name === "string" ? meta.name : undefined;

        setUserInfo({
          id: u.id,
          email: u.email ?? undefined,
          name: metaFullName || metaName || u.email || "User",
        });
      })
      .catch(() => {
        // ignore
      });
  }, []);

  useEffect(() => {
    const handleOpenChat = (event: Event) => {
      setOpen(true);
      const customEvent = event as CustomEvent<{ message?: string }>;
      const initialMessage = customEvent.detail?.message;
      if (typeof initialMessage === "string" && initialMessage.trim()) {
        setText(initialMessage.trim());
        setActiveView("chat");
      } else {
        setActiveView("faq");
      }
    };

    window.addEventListener("gl:open-chat", handleOpenChat as EventListener);
    return () => window.removeEventListener("gl:open-chat", handleOpenChat as EventListener);
  }, []);

  const clearStoredToken = () => {
    try {
      localStorage.removeItem(LS_TOKEN);
    } catch {
      // ignore
    }
  };

  const clearActiveThread = (message?: string) => {
    setToken("");
    setThread(null);
    setMessages([]);
    clearStoredToken();
    if (message) {
      setChatError(message);
    }
  };

  const ensureThread = async (forceNew = false) => {
    if (!forceNew && token) return token;

    // If logged in, auto-create thread without asking for name/email
    if (userInfo?.id) {
      const res = await fetch("/api/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userInfo.id,
          name: userInfo.name,
          email: userInfo.email,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to create chat thread");

      const t = String(json?.token || "");
      setToken(t);
      try {
        localStorage.setItem(LS_TOKEN, t);
      } catch {}
      return t;
    }

    return "";
  };

  const recoverMissingThread = async () => {
    clearActiveThread(
      userInfo?.id
        ? "Your previous chat session expired. Please send your message again."
        : "Your previous chat session expired. Enter your details to start again."
    );

    if (userInfo?.id) {
      return await ensureThread(true);
    }

    const name = startName.trim();
    const email = startEmail.trim();
    if (!name || !email || !email.includes("@")) {
      return "";
    }

    return await startChat();
  };

  const isNearBottom = () => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 56;
  };

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior });
  };

  const refresh = async (tkn?: string, opts?: { forceScrollToBottom?: boolean }) => {
    const t = (tkn ?? token).trim();
    if (!t) return;

    const shouldAutoScroll = opts?.forceScrollToBottom || shouldStickToBottomRef.current || isNearBottom();

    const res = await fetch(`/api/chat/messages?token=${encodeURIComponent(t)}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.status === 404) {
      clearActiveThread(
        userInfo?.id
          ? "Your previous chat session expired. Send a new message to continue."
          : "Your previous chat session expired. Enter your details to start again."
      );
      return;
    }
    if (!res.ok) throw new Error(json?.error || "Failed to load messages");

    setChatError(null);
    setThread(json.thread as ThreadInfo);
    setMessages((json.messages || []) as ChatMessage[]);

    if (shouldAutoScroll) {
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  };

  useEffect(() => {
    if (!open || activeView !== "chat") return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        setLoading(true);
        const t = await ensureThread();
        if (cancelled) return;
        if (t) await refresh(t, { forceScrollToBottom: true });
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }

      interval = setInterval(() => {
        if (!token) return;
        refresh().catch(() => undefined);
      }, 2500);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, userInfo?.id, activeView]);

  const startChat = async () => {
    const name = startName.trim();
    const email = startEmail.trim();

    if (!name) throw new Error("Please enter your name");
    if (!email || !email.includes("@")) throw new Error("Please enter a valid Gmail/email");

    setLoading(true);
    try {
      const res = await fetch("/api/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to start chat");

      const t = String(json?.token || "");
      setToken(t);
      try {
        localStorage.setItem(LS_TOKEN, t);
        localStorage.setItem(LS_NAME, name);
        localStorage.setItem(LS_EMAIL, email);
      } catch {}

      return t;
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (options?: { overrideToken?: string; overrideMessage?: string }) => {
    let t = (options?.overrideToken ?? token).trim();
    const message = (options?.overrideMessage ?? text).trim();
    if (!message) {
      setChatError("Please enter a message to start the chat.");
      return;
    }

    if (!t) {
      if (userInfo?.id) {
        t = await ensureThread();
      } else {
        t = await startChat();
      }
    }

    if (!t) {
      setChatError("Unable to start chat right now.");
      return;
    }

    setChatError(null);

    const senderType = userInfo?.id ? "user" : "visitor";

    let retried = false;

    while (true) {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: t,
          senderType,
          senderName: userInfo?.name || startName || "Guest",
          senderEmail: userInfo?.email || startEmail || "",
          message,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        setText("");
        break;
      }

      if (res.status === 404 && !retried) {
        retried = true;
        t = await recoverMissingThread();
        if (!t) {
          return;
        }
        continue;
      }

      throw new Error(json?.error || "Failed to send message");
    }

    await refresh(t, { forceScrollToBottom: true });
  };

  const uploadImage = async (file: File) => {
    let t = token.trim();
    if (!t) {
      if (userInfo?.id) {
        t = await ensureThread();
      } else {
        setChatError("Enter your details first before uploading an image.");
        return;
      }
    }

    setUploading(true);
    try {
      const senderType = userInfo?.id ? "user" : "visitor";

      let retried = false;

      while (true) {
        const form = new FormData();
        form.append("token", t);
        form.append("file", file);

        const up = await fetch("/api/chat/upload", { method: "POST", body: form });
        const upJson = await up.json().catch(() => ({}));

        if (up.status === 404 && !retried) {
          retried = true;
          t = await recoverMissingThread();
          if (!t) {
            return;
          }
          continue;
        }

        if (!up.ok) throw new Error(upJson?.error || "Upload failed");

        const url = String(upJson?.url || "");
        if (!url) throw new Error("Upload failed (no url)");

        const res = await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: t,
            senderType,
            senderName: userInfo?.name || startName || "Guest",
            senderEmail: userInfo?.email || startEmail || "",
            imageUrl: url,
          }),
        });

        const json = await res.json().catch(() => ({}));

        if (res.status === 404 && !retried) {
          retried = true;
          t = await recoverMissingThread();
          if (!t) {
            return;
          }
          continue;
        }

        if (!res.ok) throw new Error(json?.error || "Failed to send image");

        break;
      }

      await refresh(t, { forceScrollToBottom: true });
    } finally {
      setUploading(false);
    }
  };

  const resetChat = () => {
    clearActiveThread();
    setText("");
    setChatError(null);
  };

  const handleFaqPreview = (faq: FaqItem) => {
    if (faq.categoryId) {
      setActiveFaqCategoryId(faq.categoryId);
    }
    setActiveFaqId((prev) => (prev === faq.id ? null : faq.id));
  };

  const handleFaqLiveChat = (faq?: FaqItem | null) => {
    if (faq) {
      if (faq.categoryId) {
        setActiveFaqCategoryId(faq.categoryId);
      }
      setActiveFaqId(faq.id);
      setText(faq.quickMessage);
    }
    setChatError(null);
    setActiveView("chat");
  };

  const activeFaq = faqItems.find((faq) => faq.id === activeFaqId) || null;

  return (
    <>
      {/* Floating Button */}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) setActiveView("faq");
            return next;
          });
        }}
        className="fixed bottom-5 right-5 z-[9999] h-14 w-14 rounded-full bg-[#232d3b] text-white shadow-lg flex items-center justify-center hover:bg-[#1b2230] transition"
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? (
          <span className="text-2xl leading-none">×</span>
        ) : (
          <span className="text-xl">💬</span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-[9999] w-[92vw] max-w-[380px] h-[520px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 bg-[#232d3b] text-white flex items-center justify-between">
            <div>
              <div className="font-semibold">Customer Support</div>
              <div className="text-xs opacity-90">
                {activeView === "faq"
                  ? "Browse FAQs or start a live chat"
                  : thread?.status === "active"
                  ? "Connected"
                  : thread?.status === "resolved"
                  ? "Resolved"
                  : thread?.status === "pending"
                  ? "Waiting for admin to accept"
                  : "Start a live chat"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-sm bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg"
                onClick={() => setActiveView((prev) => (prev === "faq" ? "chat" : "faq"))}
              >
                {activeView === "faq" ? "Start Live Chat" : "Back to FAQs"}
              </button>
              <button
                type="button"
                className="text-sm bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>

          {/* Body */}
          <div
            ref={messagesContainerRef}
            className="flex-1 bg-gray-50 p-3 overflow-y-auto"
            onScroll={() => {
              shouldStickToBottomRef.current = isNearBottom();
            }}
          >
            {loading && !messages.length ? (
              <div className="text-sm text-gray-500">Loading…</div>
            ) : null}

            {activeView === "faq" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-gray-900">How can we help?</div>
                      <div className="mt-1 text-xs leading-5 text-gray-600">
                        Browse the same FAQs from our FAQ page, then switch to a full live chat if you need help from Admin or Customer Service.
                      </div>
                    </div>
                    <span className="rounded-full bg-red-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#8B1C1C]">
                      FAQ Support
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleFaqLiveChat()}
                    className="mt-4 w-full rounded-xl bg-[#8B1C1C] px-4 py-3 text-sm font-semibold text-white hover:bg-[#741818]"
                  >
                    Start Live Chat with Admin / Customer Service
                  </button>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <label className="block text-sm font-semibold text-gray-900">Search FAQs</label>
                  <div className="relative mt-2">
                    <input
                      value={faqSearch}
                      onChange={(e) => {
                        setFaqSearch(e.target.value);
                        setActiveFaqId(null);
                      }}
                      placeholder="Search by keyword (delivery, payment, installation)"
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 pr-16 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#8B1C1C]"
                    />
                    {faqSearch.trim() ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFaqSearch("");
                          setActiveFaqId(null);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 hover:text-[#8B1C1C]"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  {faqSearch.trim() ? (
                    <p className="mt-2 text-[11px] text-gray-500">
                      Showing matches from every category. Clear search to browse topic by topic.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Browse by topic</div>
                      <div className="text-[11px] text-gray-500">Tap a category to narrow the FAQ list.</div>
                    </div>
                    <div className="text-[11px] font-semibold text-gray-500">{filteredFaqItems.length} result{filteredFaqItems.length === 1 ? "" : "s"}</div>
                  </div>

                  <div
                    className={`mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 ${
                      faqSearch.trim() ? "opacity-50 pointer-events-none" : ""
                    }`}
                  >
                    {faqCategoryOptions.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => {
                          setActiveFaqCategoryId(category.id);
                          setFaqSearch("");
                          setActiveFaqId(null);
                        }}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          activeFaqCategoryId === category.id || (!activeFaqCategoryId && category.id === faqCategoryOptions[0]?.id)
                            ? "bg-[#8B1C1C] text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-[#8B1C1C]"
                        }`}
                      >
                        {category.name}
                      </button>
                    ))}
                  </div>
                </div>

                {featuredFaqItems.length ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Quick FAQs</div>
                        <div className="text-[11px] text-gray-500">Swipe through common questions for faster help.</div>
                      </div>
                    </div>

                    <div className="mt-3 -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
                      {featuredFaqItems.map((faq) => (
                        <button
                          key={faq.id}
                          type="button"
                          onClick={() => handleFaqPreview(faq)}
                          className="min-w-[230px] max-w-[230px] shrink-0 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left shadow-sm transition hover:border-[#8B1C1C] hover:bg-white"
                        >
                          {faq.categoryName ? (
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8B1C1C]">
                              {faq.categoryName}
                            </div>
                          ) : null}
                          <div className="text-sm font-semibold leading-5 text-gray-900 line-clamp-2">
                            {faq.question}
                          </div>
                          <div className="mt-2 text-xs leading-5 text-gray-600 line-clamp-3">
                            {faq.answer}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {activeFaq ? (
                  <div className="rounded-2xl border border-[#8B1C1C]/20 bg-red-50/40 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Selected FAQ</div>
                        <div className="mt-1 text-sm font-medium text-[#8B1C1C]">{activeFaq.question}</div>
                      </div>
                      {activeFaq.categoryName ? (
                        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-gray-600 shadow-sm">
                          {activeFaq.categoryName}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 text-sm leading-6 text-gray-700">{activeFaq.answer}</div>
                    <button
                      type="button"
                      onClick={() => handleFaqLiveChat(activeFaq)}
                      className="mt-4 rounded-xl bg-[#232d3b] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1b2230]"
                    >
                      Ask this in Live Chat
                    </button>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {filteredFaqItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-600">
                      No FAQ results found.
                    </div>
                  ) : (
                    filteredFaqItems.map((faq) => {
                      const isOpen = activeFaqId === faq.id;
                      return (
                        <div key={faq.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                          <button
                            type="button"
                            onClick={() => handleFaqPreview(faq)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                          >
                            <div className="min-w-0">
                              {faqSearch.trim() && faq.categoryName ? (
                                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                  {faq.categoryName}
                                </div>
                              ) : null}
                              <div className="text-sm font-medium text-gray-900">{faq.question}</div>
                            </div>
                            <span className="text-lg font-bold text-[#8B1C1C]">{isOpen ? "−" : "+"}</span>
                          </button>
                          {isOpen ? (
                            <div className="border-t border-gray-100 px-4 py-3 text-sm text-gray-700">
                              <div>{faq.answer}</div>
                              <button
                                type="button"
                                onClick={() => handleFaqLiveChat(faq)}
                                className="mt-3 rounded-lg bg-[#232d3b] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1b2230]"
                              >
                                Ask this in live chat
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : !thread && !userInfo?.id ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                <div className="mb-3">
                  <div className="text-sm font-semibold text-gray-900">Start a chat with Admin / Customer Service</div>
                  <div className="mt-1 text-xs text-gray-600">
                    Enter your details, type your first message, and you will go straight into the live chat.
                  </div>
                </div>

                <label className="text-xs font-medium text-gray-600">Name</label>
                <input
                  value={startName}
                  onChange={(e) => setStartName(e.target.value)}
                  className="w-full mt-1 mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
                  placeholder="Your name"
                />
                <label className="text-xs font-medium text-gray-600">Gmail / Email</label>
                <input
                  value={startEmail}
                  onChange={(e) => setStartEmail(e.target.value)}
                  className="w-full mt-1 mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
                  placeholder="you@gmail.com"
                  type="email"
                />

                <label className="text-xs font-medium text-gray-600">Message</label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#8B1C1C]"
                  placeholder="Type your concern here and we will connect you to the live chat..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage().catch((err) => setChatError(err?.message || "Unable to start chat"));
                    }
                  }}
                />

                {chatError ? <div className="mt-3 text-xs text-red-600">{chatError}</div> : null}

                <button
                  type="button"
                  disabled={loading || !text.trim()}
                  onClick={() => sendMessage().catch((err) => setChatError(err?.message || "Unable to start chat"))}
                  className="mt-3 w-full bg-[#232d3b] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#1b2230] disabled:opacity-50"
                >
                  Send and Start Chat
                </button>
              </div>
            ) : (
              <>
                {thread?.status === "resolved" ? (
                  <div className="sticky top-0 z-10 bg-yellow-50 border border-yellow-200 text-yellow-900 rounded-xl p-3 text-sm mb-3 flex items-center justify-between gap-2 shadow-sm">
                    <span>This conversation is marked as resolved.</span>
                    <button type="button" className="underline" onClick={resetChat}>
                      Start new chat
                    </button>
                  </div>
                ) : null}

                {messages.map((m) => {
                  const isMe = m.sender_type !== "admin";
                  return (
                    <div
                      key={m.id}
                      className={`mb-2 flex ${isMe ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm border ${
                          isMe
                            ? "bg-white border-gray-200"
                            : "bg-[#232d3b] text-white border-[#232d3b]"
                        }`}
                      >
                        {m.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.image_url}
                            alt="Uploaded"
                            className="rounded-xl max-h-56 w-auto"
                          />
                        ) : null}
                        {m.body ? (
                          <div className={`text-sm ${isMe ? "text-gray-900" : "text-white"}`}>
                            {m.body}
                          </div>
                        ) : null}
                        <div className={`text-[10px] mt-1 ${isMe ? "text-gray-500" : "text-white/80"}`}>
                          {formatTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Input */}
          {activeView === "chat" && thread && (
            <div className="p-3 bg-white border-t border-gray-200">
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-300 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={!canSend || uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      uploadImage(file).catch((err) => alert(err?.message || "Upload failed"));
                    }}
                  />
                  <span className="text-lg">📎</span>
                </label>

                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={!canSend}
                  className="flex-1 h-10 px-3 border border-gray-300 rounded-lg text-sm text-gray-900 disabled:bg-gray-100"
                  placeholder={
                    thread?.status === "resolved"
                      ? "Chat resolved"
                      : thread?.status === "pending"
                      ? "Type a message…"
                      : "Type a message…"
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendMessage().catch((err) => alert(err?.message || "Send failed"));
                    }
                  }}
                />

                <button
                  type="button"
                  onClick={() => sendMessage().catch((err) => setChatError(err?.message || "Send failed"))}
                  disabled={!canSend || !text.trim()}
                  className="h-10 px-4 rounded-lg bg-[#232d3b] text-white text-sm hover:bg-[#1b2230] disabled:opacity-50"
                >
                  Send
                </button>
              </div>
              {chatError ? <div className="mt-2 text-xs text-red-600">{chatError}</div> : null}
              {uploading ? (
                <div className="text-xs text-gray-500 mt-2">Uploading image…</div>
              ) : null}
            </div>
          )}

          {activeView === "faq" ? (
            <div className="bg-gray-100 border-t border-gray-200 p-3">
              <button
                type="button"
                onClick={() => handleFaqLiveChat(activeFaq)}
                className="w-full rounded-xl bg-[#8B1C1C] px-4 py-3 text-sm font-semibold text-white hover:bg-[#741818]"
              >
                {activeFaq ? "Continue to Live Chat about this FAQ" : "Go to Live Chat with Admin / Customer Service"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
