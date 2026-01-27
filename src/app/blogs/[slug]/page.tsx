"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { FaHeart, FaRegHeart, FaShareAlt, FaArrowLeft } from "react-icons/fa";
import type { User } from "@supabase/supabase-js";

type BlogRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  content_html: string | null;
  published_at: string | null;
  created_at: string;
  author_name: string | null;
};

type BlogLikeCountRow = {
  blog_id: string;
  like_count: number;
};

type RecentBlogRow = {
  id: string;
  title: string;
  slug: string;
  cover_image_url: string | null;
  published_at: string | null;
  created_at: string;
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

function stripHtmlToText(html: string) {
  if (typeof document === "undefined") return html;
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent || el.innerText || "").trim();
}

export default function BlogDetailPage() {
  const params = useParams();
  const slug = typeof params?.slug === "string" ? params.slug : Array.isArray(params?.slug) ? params.slug[0] : "";

  const [user, setUser] = useState<User | null>(null);
  const [blog, setBlog] = useState<BlogRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [recentPosts, setRecentPosts] = useState<RecentBlogRow[]>([]);
  const [recentLikeCounts, setRecentLikeCounts] = useState<Record<string, number>>({});
  const [imgPopup, setImgPopup] = useState<{ open: boolean; url: string; alt?: string }>({ open: false, url: "" });
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user ?? null);
    };
    loadUser();
  }, []);

  const load = async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("blogs")
        .select("id, title, slug, excerpt, cover_image_url, content_html, published_at, created_at, author_name")
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setBlog(null);
        setLikeCount(0);
        setLiked(false);
        return;
      }

      const row = data as BlogRow;
      setBlog(row);

      // like counts
      const likeCountReq = supabase
        .from("blog_like_counts")
        .select("blog_id, like_count")
        .eq("blog_id", row.id)
        .maybeSingle();

      const recentReq = supabase
        .from("blogs")
        .select("id, title, slug, cover_image_url, published_at, created_at")
        .eq("is_published", true)
        .neq("id", row.id)
        .order("published_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(3);

      const myLikesReq = user?.id
        ? supabase.from("blog_likes").select("blog_id").eq("blog_id", row.id).eq("user_id", user.id)
        : Promise.resolve({ data: [] as { blog_id: string }[] });

      const [{ data: likeCountRow }, { data: myLikes }, { data: recentRows, error: recentErr }] = await Promise.all([
        likeCountReq,
        myLikesReq,
        recentReq,
      ]);

      if (recentErr) throw recentErr;
      const recent = (recentRows || []) as RecentBlogRow[];
      setRecentPosts(recent);

      const ids = recent.map((r) => r.id).filter(Boolean);
      if (ids.length) {
        const { data: counts, error: countsErr } = await supabase
          .from("blog_like_counts")
          .select("blog_id, like_count")
          .in("blog_id", ids);
        if (countsErr) throw countsErr;
        const map: Record<string, number> = {};
        (counts || []).forEach((c: any) => {
          map[String(c.blog_id)] = Number(c.like_count || 0);
        });
        setRecentLikeCounts(map);
      } else {
        setRecentLikeCounts({});
      }

      setLikeCount(Number((likeCountRow as BlogLikeCountRow | null | undefined)?.like_count || 0));
      setLiked((myLikes || []).length > 0);
    } catch (e) {
      console.error("blog load error", e);
      setBlog(null);
      setLikeCount(0);
      setLiked(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, user?.id]);

  useEffect(() => {
    if (!slug) return;
    const ch = supabase
      .channel(`website_blog_${slug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "blogs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "blog_likes" }, () => load())
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, user?.id]);

  const share = async () => {
    if (!blog) return;
    const url = safeShareUrl(`/blogs/${blog.slug}`);

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: blog.title, url });
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

  const toggleLike = async () => {
    if (!blog) return;
    if (!user?.id) {
      showToast("Please log in to heart blogs.");
      return;
    }

    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));

    try {
      if (wasLiked) {
        const { error } = await supabase.from("blog_likes").delete().eq("blog_id", blog.id).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("blog_likes").insert({ blog_id: blog.id, user_id: user.id });
        if (error) throw error;
      }
    } catch (e) {
      console.error("toggle like error", e);
      setLiked(wasLiked);
      setLikeCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
      showToast("Could not update heart.");
    }
  };

  const excerptText = useMemo(() => {
    if (!blog) return "";
    if (blog.excerpt) return blog.excerpt;
    if (blog.content_html) return stripHtmlToText(blog.content_html).slice(0, 160);
    return "";
  }, [blog]);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <UnifiedTopNavBar />

      <main className="flex-1">
        <section className="max-w-4xl mx-auto px-6 py-10">
          <Link href="/blogs" className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-[#8B1C1C]">
            <FaArrowLeft />
            Back to Blogs
          </Link>

          {loading ? (
            <div className="mt-6 text-gray-600">Loading…</div>
          ) : !blog ? (
            <div className="mt-6 bg-gray-50 border rounded-lg p-6 text-gray-700">Blog not found.</div>
          ) : (
            <article className="mt-6">
              <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900">{blog.title}</h1>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                <span>{formatDate(blog.published_at || blog.created_at)}</span>
                {blog.author_name ? <span>• By {blog.author_name}</span> : null}
                {excerptText ? <span className="hidden md:inline">• {excerptText}</span> : null}
              </div>

              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={share}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border hover:bg-gray-50 text-gray-800"
                  aria-label="Share blog"
                >
                  <FaShareAlt />
                  Share
                </button>

                <button
                  type="button"
                  onClick={toggleLike}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border hover:bg-gray-50 text-gray-800"
                  aria-label="Heart blog"
                  title={user?.id ? "Heart" : "Log in to heart"}
                >
                  {liked ? <FaHeart className="text-[#8B1C1C]" /> : <FaRegHeart className="text-gray-600" />}
                  <span className="font-semibold">{likeCount}</span>
                </button>
              </div>

              {blog.cover_image_url ? (
                <div className="mt-8">
                  <button
                    type="button"
                    onClick={() => setImgPopup({ open: true, url: blog.cover_image_url!, alt: blog.title })}
                    className="block w-full"
                    aria-label="Open cover image"
                    title="View image"
                  >
                    <img
                      src={blog.cover_image_url}
                      alt={blog.title}
                      className="w-full max-h-[420px] object-cover rounded-xl border shadow-sm"
                    />
                  </button>
                </div>
              ) : null}

              <div className="mt-8 blog-content">
                {/* Note: relies on admin sanitizing content_html */}
                <div dangerouslySetInnerHTML={{ __html: blog.content_html || "" }} />
              </div>

              {/* Recent Posts */}
              {recentPosts.length ? (
                <div className="mt-12">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900">Recent Posts</h2>
                    <Link href="/blogs" className="text-sm text-gray-700 hover:text-[#8B1C1C]">
                      See All
                    </Link>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {recentPosts.map((p) => {
                      const hearts = recentLikeCounts[p.id] || 0;
                      return (
                        <div key={p.id} className="bg-white rounded-xl shadow border overflow-hidden">
                          <Link href={`/blogs/${p.slug}`} className="block">
                            {p.cover_image_url ? (
                              <img src={p.cover_image_url} alt={p.title} className="w-full h-40 object-cover" />
                            ) : (
                              <div className="w-full h-40 bg-gray-200" />
                            )}
                          </Link>

                          <div className="p-4">
                            <Link href={`/blogs/${p.slug}`} className="block">
                              <div className="font-bold text-gray-900 hover:text-[#8B1C1C] transition-colors line-clamp-2">
                                {p.title}
                              </div>
                            </Link>

                            <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
                              <span>{formatDate(p.published_at || p.created_at)}</span>
                              <span className="inline-flex items-center gap-2">
                                <FaRegHeart className="text-gray-600" />
                                <span className="font-semibold">{hearts}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </article>
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
