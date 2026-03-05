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
};

const CHAT_FAQS: FaqItem[] = [
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

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const [userInfo, setUserInfo] = useState<{ id: string; email?: string; name?: string } | null>(null);

  const canSend = useMemo(() => {
    if (!thread) return false;
    if (thread.status === "resolved") return false;
    // Visitors/users can send while pending; admin replies after accept.
    return true;
  }, [thread]);

  useEffect(() => {
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
      }
    };

    window.addEventListener("gl:open-chat", handleOpenChat as EventListener);
    return () => window.removeEventListener("gl:open-chat", handleOpenChat as EventListener);
  }, []);

  const ensureThread = async () => {
    if (token) return token;

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
    if (!res.ok) throw new Error(json?.error || "Failed to load messages");

    setThread(json.thread as ThreadInfo);
    setMessages((json.messages || []) as ChatMessage[]);

    if (shouldAutoScroll) {
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  };

  useEffect(() => {
    if (!open) return;

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
  }, [open, token, userInfo?.id]);

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

      await refresh(t, { forceScrollToBottom: true });
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    const t = token.trim();
    if (!t) return;

    const message = text.trim();
    if (!message) return;

    setText("");

    const senderType = userInfo?.id ? "user" : "visitor";

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
    if (!res.ok) throw new Error(json?.error || "Failed to send message");

    await refresh(t, { forceScrollToBottom: true });
  };

  const uploadImage = async (file: File) => {
    const t = token.trim();
    if (!t) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("token", t);
      form.append("file", file);

      const up = await fetch("/api/chat/upload", { method: "POST", body: form });
      const upJson = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upJson?.error || "Upload failed");

      const url = String(upJson?.url || "");
      if (!url) throw new Error("Upload failed (no url)");

      const senderType = userInfo?.id ? "user" : "visitor";

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
      if (!res.ok) throw new Error(json?.error || "Failed to send image");

      await refresh(t, { forceScrollToBottom: true });
    } finally {
      setUploading(false);
    }
  };

  const resetChat = () => {
    setToken("");
    setThread(null);
    setMessages([]);
    setText("");

    try {
      localStorage.removeItem(LS_TOKEN);
    } catch {}
  };

  const handleFaqClick = (faq: FaqItem) => {
    setActiveFaqId((prev) => (prev === faq.id ? null : faq.id));
    setText(faq.quickMessage);
  };

  const activeFaq = CHAT_FAQS.find((faq) => faq.id === activeFaqId) || null;

  return (
    <>
      {/* Floating Button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
              <div className="font-semibold">Chat with Admin</div>
              <div className="text-xs opacity-90">
                {thread?.status === "active"
                  ? "Connected"
                  : thread?.status === "resolved"
                  ? "Resolved"
                  : thread?.status === "pending"
                  ? "Waiting for admin to accept"
                  : "Start a chat"}
              </div>
            </div>
            <button
              type="button"
              className="text-sm bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
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

            {!token && !userInfo?.id ? (
              <div className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="text-sm font-semibold text-gray-900 mb-2">
                  Enter your details to start
                </div>
                <label className="text-xs text-gray-600">Name</label>
                <input
                  value={startName}
                  onChange={(e) => setStartName(e.target.value)}
                  className="w-full mt-1 mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
                  placeholder="Your name"
                />
                <label className="text-xs text-gray-600">Gmail / Email</label>
                <input
                  value={startEmail}
                  onChange={(e) => setStartEmail(e.target.value)}
                  className="w-full mt-1 mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
                  placeholder="you@gmail.com"
                  type="email"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => startChat().catch((e) => alert(e?.message || "Unable to start chat"))}
                  className="w-full bg-[#232d3b] text-white rounded-lg py-2 text-sm hover:bg-[#1b2230] disabled:opacity-50"
                >
                  Start Chat
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
          {(token || userInfo?.id) && (
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
                  onClick={() => sendMessage().catch((err) => alert(err?.message || "Send failed"))}
                  disabled={!canSend || !text.trim()}
                  className="h-10 px-4 rounded-lg bg-[#232d3b] text-white text-sm hover:bg-[#1b2230] disabled:opacity-50"
                >
                  Send
                </button>
              </div>
              {uploading ? (
                <div className="text-xs text-gray-500 mt-2">Uploading image…</div>
              ) : null}
            </div>
          )}

          <div className="bg-gray-100 border-t border-gray-200 p-3">
            <div className="text-sm font-semibold text-gray-800 text-center">Instant answers</div>
            <div className="mt-2 space-y-2 max-h-44 overflow-y-auto pr-1">
              {CHAT_FAQS.map((faq) => (
                <button
                  key={faq.id}
                  type="button"
                  onClick={() => handleFaqClick(faq)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-900"
                >
                  {faq.question}
                </button>
              ))}
            </div>
            {activeFaq ? (
              <div className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700">
                {activeFaq.answer}
              </div>
            ) : null}
            <div className="mt-2 text-[11px] text-gray-600">
              Tap a question to auto-fill the live chat message.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
