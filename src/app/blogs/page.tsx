"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { FaHeart, FaRegHeart, FaShareAlt } from "react-icons/fa";
import type { User } from "@supabase/supabase-js";

type Blog = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  created_at: string;
  author_name: string | null;
};

type BlogLikeCountRow = {
  blog_id: string;
  like_count: number;
};

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function safeShareUrl(path: string) {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export default function BlogsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [loading, setLoading] = useState(true);
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [likedByMe, setLikedByMe] = useState<Record<string, boolean>>({});
  const [imgPopup, setImgPopup] = useState<{ open: boolean; url: string; alt?: string }>({ open: false, url: "" });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user ?? null);
    };
    loadUser();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("blogs")
        .select("id, title, slug, excerpt, cover_image_url, published_at, created_at, author_name")
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      const rows = (data || []) as Blog[];
      setBlogs(rows);

      const ids = rows.map((b) => b.id).filter(Boolean);
      if (ids.length === 0) {
        setLikeCounts({});
        setLikedByMe({});
        return;
      }

      const likeCountsReq = supabase.from("blog_like_counts").select("blog_id, like_count").in("blog_id", ids);
      const myLikesReq = user?.id
        ? supabase.from("blog_likes").select("blog_id").eq("user_id", user.id).in("blog_id", ids)
        : Promise.resolve({ data: [] as { blog_id: string }[] });

      const [{ data: likeCountsRows }, { data: myLikes }] = await Promise.all([likeCountsReq, myLikesReq]);

      const counts: Record<string, number> = {};
      (likeCountsRows as BlogLikeCountRow[] | null | undefined)?.forEach((r) => {
        counts[String(r.blog_id)] = Number(r.like_count || 0);
      });
      setLikeCounts(counts);

      const mine: Record<string, boolean> = {};
      (myLikes || []).forEach((r: { blog_id: string }) => {
        mine[String(r.blog_id)] = true;
      });
      setLikedByMe(mine);
    } catch (e) {
      console.error("blogs load error", e);
      setBlogs([]);
      setLikeCounts({});
      setLikedByMe({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Realtime refresh when blogs change
  useEffect(() => {
    const ch = supabase
      .channel("website_blogs")
      .on("postgres_changes", { event: "*", schema: "public", table: "blogs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "blog_likes" }, () => load())
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const newest = useMemo(() => blogs, [blogs]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const toggleLike = async (blogId: string) => {
    if (!user?.id) {
      showToast("Please log in to heart blogs.");
      return;
    }

    const isLiked = !!likedByMe[blogId];
    setLikedByMe((p) => ({ ...p, [blogId]: !isLiked }));
    setLikeCounts((p) => ({ ...p, [blogId]: Math.max(0, (p[blogId] || 0) + (isLiked ? -1 : 1)) }));

    try {
      if (isLiked) {
        const { error } = await supabase.from("blog_likes").delete().eq("blog_id", blogId).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("blog_likes").insert({ blog_id: blogId, user_id: user.id });
        if (error) throw error;
      }
    } catch (e) {
      console.error("toggle like error", e);
      // rollback
      setLikedByMe((p) => ({ ...p, [blogId]: isLiked }));
      setLikeCounts((p) => ({ ...p, [blogId]: Math.max(0, (p[blogId] || 0) + (isLiked ? 1 : -1)) }));
      showToast("Could not update heart. Please try again.");
    }
  };

  const shareBlog = async (slug: string, title: string) => {
    const url = safeShareUrl(`/blogs/${slug}`);

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        showToast("Link copied.");
        return;
      }

      showToast("Copy not supported on this browser.");
    } catch (e) {
      console.error("share error", e);
      showToast("Could not share.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <UnifiedTopNavBar />

      <main className="flex-1">
        {/* Hero */}
        <div className="relative w-full">
          <div className="h-64 md:h-80 relative bg-gradient-to-r from-[#111827] to-[#1f2937]">
            <div className="absolute inset-0 bg-black/40 mix-blend-multiply" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center px-6">
                <h1 className="text-4xl md:text-5xl font-extrabold text-white drop-shadow-lg">Blogs</h1>
                <div className="h-1.5 w-24 bg-[#8B1C1C] mx-auto mt-6 rounded" />
                <p className="mt-5 text-white/80 max-w-2xl mx-auto">
                  Read the newest updates, tips, and inspiration from Grand Link.
                </p>
              </div>
            </div>
          </div>
        </div>

        <section className="max-w-6xl mx-auto px-6 py-10">
          {loading ? (
            <div className="text-gray-600">Loading blogs…</div>
          ) : newest.length === 0 ? (
            <div className="bg-gray-50 border rounded-lg p-6 text-gray-700">No blogs yet.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {newest.map((b) => {
                const hearts = likeCounts[b.id] || 0;
                const isLiked = !!likedByMe[b.id];

                return (
                  <div key={b.id} className="bg-white rounded-xl shadow border overflow-hidden">
                    <div className="relative">
                      {b.cover_image_url ? (
                        <button
                          type="button"
                          onClick={() => setImgPopup({ open: true, url: b.cover_image_url!, alt: b.title })}
                          className="block w-full"
                          aria-label="Open image"
                          title="View image"
                        >
                          <img src={b.cover_image_url} alt={b.title} className="w-full h-44 object-cover" />
                        </button>
                      ) : (
                        <div className="w-full h-44 bg-gray-200" />
                      )}
                      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-semibold text-gray-800">
                        {formatDate(b.published_at || b.created_at)}
                      </div>
                    </div>

                    <div className="p-5">
                      <Link href={`/blogs/${b.slug}`} className="block">
                        <h2 className="text-lg font-bold text-gray-900 hover:text-[#8B1C1C] transition-colors line-clamp-2">
                          {b.title}
                        </h2>
                      </Link>

                      <div className="mt-2 text-sm text-gray-600 line-clamp-3">
                        {b.excerpt || ""}
                      </div>

                      <div className="mt-4 flex items-center justify-between">
                        <Link
                          href={`/blogs/${b.slug}`}
                          className="text-sm font-semibold text-[#8B1C1C] hover:underline"
                        >
                          Read more
                        </Link>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => shareBlog(b.slug, b.title)}
                            className="p-2 rounded-full hover:bg-gray-100 text-gray-700"
                            aria-label="Share blog"
                            title="Share"
                          >
                            <FaShareAlt />
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleLike(b.id)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-full border hover:bg-gray-50 text-gray-800"
                            aria-label="Heart blog"
                            title={user?.id ? "Heart" : "Log in to heart"}
                          >
                            {isLiked ? <FaHeart className="text-[#8B1C1C]" /> : <FaRegHeart className="text-gray-600" />}
                            <span className="text-sm font-semibold">{hearts}</span>
                          </button>
                        </div>
                      </div>

                      {b.author_name ? (
                        <div className="mt-3 text-xs text-gray-500">By {b.author_name}</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Image Popup */}
        {imgPopup.open && (
          <div
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setImgPopup({ open: false, url: "" })}
            role="dialog"
            aria-modal="true"
          >
            <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
              <div className="bg-white rounded-xl overflow-hidden shadow-xl">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="text-sm font-semibold text-gray-800">{imgPopup.alt || "Image"}</div>
                  <button
                    type="button"
                    onClick={() => setImgPopup({ open: false, url: "" })}
                    className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-800"
                  >
                    Close
                  </button>
                </div>
                <div className="bg-black">
                  <img src={imgPopup.url} alt={imgPopup.alt || "Blog image"} className="w-full max-h-[80vh] object-contain" />
                </div>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-black text-white px-4 py-2 rounded-full text-sm shadow">
            {toast}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
