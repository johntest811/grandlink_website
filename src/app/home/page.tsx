"use client";

import Link from "next/link";
import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";

type HomeContent = {
  carousel?: Array<{ image?: string; youtube_url?: string; title?: string; buttonText?: string; buttonLink?: string }>;
  explore?: Array<{ image?: string; title?: string; buttonText?: string; buttonLink?: string }>;
  featured_projects?: Array<{ image?: string; title?: string; description?: string; youtube_url?: string }>;
  featured_long_images?: Array<{ image?: string; title?: string; description?: string }>;
  payment?: { payrex_phone?: string; payrex_number?: string };
  services?: { images?: string[]; title?: string; description?: string; buttonText?: string; buttonLink?: string };
  about?: { logo?: string; title?: string; description?: string; buttonText?: string; buttonLink?: string };
  [k: string]: any;
};

// Supabase client (client-side; uses public anon key)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON);


// singleton id used by the admin API/backend
const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

// helper to convert storage file key -> public url (or pass through full urls)
function getImageUrl(val?: string) {
  if (!val) return "";
  const v = String(val).trim();
  // If it's already an absolute URL, just return it
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  // If it looks like a Next.js public asset (starts with /), use it directly
  if (v.startsWith("/")) return v;
  // Otherwise, treat it as a Supabase Storage key in the `uploads` bucket
  const base = SUPABASE_URL.replace(/\/$/, "");
  const cleaned = v.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/uploads/${encodeURIComponent(cleaned)}`;
}

function renderHtmlPreview(value: unknown): string {
  if (!value) return "";
  const source = String(value).trim();
  if (!source) return "";
  if (/<[a-z][\s\S]*>/i.test(source)) return source;
  return source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
}

export default function HomePage() {
  const [content, setContent] = useState<HomeContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [newestProducts, setNewestProducts] = useState<any[]>([]);
  
  // load 4 newest products from products table (by created_at)
  useEffect(() => {
    const loadNewest = async () => {
      if (!SUPABASE_URL || !SUPABASE_ANON) {
        console.warn("[home] Supabase env missing, skipping newest products load");
        setNewestProducts([]);
        return;
      }

      try {
        // select columns that exist in your products table
        const { data, error } = await supabaseClient
          .from("products")
          .select("id, name, description, price, images, image1, image2, image3, image4, image5, created_at")
          .order("created_at", { ascending: false })
          .limit(4);

        if (error) {
          console.warn("[home] fetch newest products error:", error);
          setNewestProducts([]);
          return;
        }
        if (!data || !Array.isArray(data) || data.length === 0) {
          console.warn("[home] products query returned no rows.");
          setNewestProducts([]);
          return;
        }

        // normalize images: prefer images[] column, otherwise gather image1..image5
        const normalized = (data as any[]).map((p) => {
          const arrFromCols = [p.image1, p.image2, p.image3, p.image4, p.image5].filter(Boolean);
          const imagesArray = Array.isArray(p.images) && p.images.length ? p.images : arrFromCols;
          const firstImage = imagesArray && imagesArray.length ? imagesArray[0] : undefined;

          return {
            id: p.id,
            title: p.title ?? p.name, // keep backward compatibility
            name: p.name,
            description: p.description,
            price: p.price,
            images: imagesArray,
            image: firstImage,
            created_at: p.created_at,
          };
        });

        setNewestProducts(normalized);
      } catch (e) {
        console.error("[home] loadNewest error:", e);
        setNewestProducts([]);
      }
    };
    loadNewest();
  }, []);

  // fallback static slides (keeps same design if DB empty)
  const fallbackSlides = [
    { id: 1, title: "Welcome to Grand East", image_url: "/aboutus.avif", link_url: "/about-us" },
    { id: 2, title: "Quality Aluminum & Glass", image_url: "/sevices.avif", link_url: "/Product" },
    { id: 3, title: "Modern Designs", image_url: "/Delivery&Ordering.avif", link_url: "/services" },
  ];

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabaseClient
          .from("home_content")
          .select("content")
          .eq("id", SINGLETON_ID)
          .single();

        if (error) {
          console.warn("fetch home_content:", error);
          setContent(null);
        } else {
          // content in DB may be stored as a JSON string or as an object.
          const raw = data?.content ?? {};
          let parsed: any = raw;
          if (typeof raw === "string") {
            try {
              parsed = JSON.parse(raw);
            } catch (e) {
              console.warn("home_content.content JSON parse failed, using raw value", e);
              parsed = raw;
            }
          }
          setContent((parsed ?? {}) as HomeContent);
        }
      } catch (err) {
        console.error("load home_content error:", err);
        setContent(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const carousel = (content?.carousel && content.carousel.length ? content.carousel : fallbackSlides) as any[];

  return (
    <div className="min-h-screen flex flex-col">
      <UnifiedTopNavBar />
      <main className="flex flex-col items-center justify-center flex-1 w-full">
        {/* Hero Section */}
        <HeroSlider slides={carousel} />

        {/* make background below the carousel white */}
        <div className="w-full bg-white">
          {/* Product Categories */}
          <section className="max-w-screen-xl mx-auto py-10 px-4">
            {/* Only show newest products (sourced directly from products table) */}
            <ProductCategory
              title="Newest Products"
              identifier="newest"
              items={newestProducts}
            />
          </section>

          {/* Explore Section */}
          <ExploreSection items={content?.explore} />

          {/* Featured Projects */}
          <FeaturedProjects projects={content?.featured_projects} />

          <FeaturedLongImageGallery items={content?.featured_long_images} />

          {/* Services + About (2x2 layout) */}
          <ServicesSection services={content?.services} about={content?.about} />
        </div>
      </main>
      <Footer />
    </div>
  );
}

// Slider Component
function HeroSlider({ slides }: { slides: any[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const getYoutubeEmbedUrl = (url?: string) => {
    if (!url) return null;

    try {
      const watchMatch = url.match(/[?&]v=([^&#]+)/);
      if (watchMatch?.[1]) return `https://www.youtube.com/embed/${watchMatch[1]}`;

      const shortMatch = url.match(/youtu\.be\/([^&#?/]+)/);
      if (shortMatch?.[1]) return `https://www.youtube.com/embed/${shortMatch[1]}`;

      const embedMatch = url.match(/youtube\.com\/embed\/([^&#?/]+)/);
      if (embedMatch?.[1]) return `https://www.youtube.com/embed/${embedMatch[1]}`;
    } catch {
      return null;
    }

    return null;
  };

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
    });
  }, [emblaApi]);

  // Manual autoplay implementation (always autoplay, including YouTube slides)
  useEffect(() => {
    if (!emblaApi) return;
    const interval = setInterval(() => {
      emblaApi.scrollNext();
    }, 4000); // Change slide every 4 seconds
    return () => clearInterval(interval);
  }, [emblaApi, selectedIndex, slides]);

  return (
    // smaller, responsive slider:
    // mobile ~240px, sm ~360px, md ~520px
    <div className="relative w-full h-[240px] sm:h-[360px] md:h-[520px] overflow-hidden">
      <div className="overflow-hidden h-full" ref={emblaRef}>
        <div className="flex h-full">
          {slides.map((slide: any, idx: number) => {
            const title = slide.title ?? slide.name ?? "";
            const link = slide.buttonLink ?? slide.link_url ?? slide.buttonLink;
            const img = slide.image ?? slide.image_url ?? slide.url ?? "";
            const src = getImageUrl(img);

            const embedUrl = getYoutubeEmbedUrl(slide.youtube_url || slide.video_url);
            return (
              <div key={idx} className="flex-[0_0_100%] relative h-full">
                {/* Video or image fills the slide area */}
                {embedUrl ? (
                  <div className="absolute inset-0 bg-black">
                    <iframe
                      src={embedUrl}
                      className="w-full h-full"
                      title={title || "Carousel video"}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                ) : src ? (
                  <div className="absolute inset-0">
                    <Image src={src} alt={title} fill className="object-cover" priority />
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-gray-300" />
                )}

                {/* Overlay: keep for image slides; for video slides, show only title (non-blocking) */}
                {embedUrl ? (
                  title ? (
                    <div className="absolute top-0 left-0 right-0 bg-black/30 text-white px-4 py-2 pointer-events-none">
                      <h2 className="text-sm sm:text-base md:text-lg font-semibold text-center">{title}</h2>
                    </div>
                  ) : null
                ) : (
                  <div className="absolute inset-0 bg-black/35 flex flex-col items-center justify-center text-white text-center px-4">
                    <h2 className="text-lg sm:text-2xl md:text-3xl font-bold mb-2">{title}</h2>
                    {link && (
                      <Link href={link} className="bg-red-600 px-4 py-2 rounded text-sm sm:text-base font-semibold hover:bg-red-700 transition">
                        {slide.buttonText ?? "Learn More"}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Dots */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-2">
        {slides.map((_, idx) => (
          <button
            key={idx}
            onClick={() => emblaApi?.scrollTo(idx)}
            className={`w-2.5 h-2.5 rounded-full ${idx === selectedIndex ? "bg-white" : "bg-gray-400"}`}
          />
        ))}
      </div>
    </div>
  );
}

function ProductCategory({
  title,
  identifier,
  items,
}: {
  title: string;
  identifier: string;
  items: any[] | undefined;
}) {
  // ensure we only render the 4 newest items passed in
  const rawList = items && items.length ? items : [];
  const list = rawList.slice(0, 4);

  return (
    <div className="mb-8" id={identifier}>
      <h2 className="text-2xl font-bold mb-5 text-black">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {list.length
          ? list.map((item: any, idx: number) => {
              // support plain string items
              if (typeof item === "string") {
                return (
                  <div key={item + idx} className="border shadow p-4">
                    <div className="h-40 bg-gray-200 flex items-center justify-center">
                      <span className="text-gray-500">Image</span>
                    </div>
                    <h3 className="mt-2 font-semibold text-center text-black">{item}</h3>
                    <button className="mt-2 bg-red-600 text-white px-3 py-1 rounded w-full">View Now</button>
                  </div>
                );
              }

              const key = item.id ?? item.title ?? item.name ?? idx;
              // prefer item.image, otherwise first of item.images
              const imgKey = item.image ?? (Array.isArray(item.images) && item.images.length ? item.images[0] : undefined);
              const img = imgKey ? getImageUrl(imgKey) : null;
              const dateLabel = item.created_at ? new Date(item.created_at).toLocaleDateString() : null;
              const previewHtml = renderHtmlPreview(item.description ?? item.summary ?? item.content);
              const displayTitle = item.title ?? item.name ?? "Untitled";

              return (
                <div key={key} className="border border-gray-200 shadow-sm hover:shadow-md transition rounded-lg p-4 flex flex-col bg-white">
                  <div className="h-40 bg-gray-200 flex items-center justify-center overflow-hidden">
                    {img ? <img src={img} alt={item.title || item.name || "Product"} className="h-full w-full object-cover" /> : <span className="text-gray-500">Image</span>}
                  </div>

                  <div className="flex-1 flex flex-col justify-between mt-2">
                    <div>
                      <h3 className="font-semibold text-center text-black">{displayTitle}</h3>
                      {previewHtml ? (
                        <div
                          className="blog-content text-sm text-gray-600 mt-2 text-center [&_*]:text-gray-600"
                          style={{
                            maxHeight: "4.75rem",
                            overflow: "hidden",
                            paddingBottom: "0.5rem",
                          }}
                          dangerouslySetInnerHTML={{ __html: previewHtml }}
                        />
                      ) : null}
                      {dateLabel ? <div className="text-xs text-gray-500 text-center mt-3">{dateLabel}</div> : null}
                    </div>

                    <div className="mt-3">
                      {/* link to product page if id exists, otherwise no-op */}
                      {item.id ? (
                        // navigate to the details page and pass id as a query param so the details page can read it
                        <Link href={`/Product/details?id=${item.id}`} className="block text-center bg-red-600 text-white px-3 py-1 rounded">
                          View Now
                        </Link>
                      ) : (
                        // fallback: go to Product listing if no id available
                        <Link href="/Product" className="w-full block text-center bg-red-600 text-white px-3 py-1 rounded">
                          View Now
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          : // fallback placeholders
            ["GE 103", "GE 79", "GE 116"].map((t) => (
               <div key={t} className="border shadow p-4">
                 <div className="h-40 bg-gray-200 flex items-center justify-center">
                   <span className="text-gray-500">Image</span>
                 </div>
                <h3 className="mt-2 font-semibold text-center text-black">{t}</h3>
                 <button className="mt-2 bg-red-600 text-white px-3 py-1 rounded w-full">View Now</button>
               </div>
             ))}
      </div>
    </div>
  );
}

function FeaturedLongImageGallery({ items }: { items?: Array<any> }) {
  const gallery = (items && items.length ? items : [
    { image: "/aboutus.avif", title: "Featured Product 1", description: "Premium aluminum and glass solution." },
    { image: "/Delivery&Ordering.avif", title: "Featured Product 2", description: "Long-format showcase for your best sellers." },
    { image: "/sevices.avif", title: "Featured Product 3", description: "Durable, modern, and elegant product design." },
  ]).slice(0, 3);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const openAt = (index: number) => setActiveIndex(index);
  const close = () => setActiveIndex(null);
  const next = () => setActiveIndex((prev) => (prev == null ? 0 : (prev + 1) % gallery.length));
  const prev = () => setActiveIndex((prev) => (prev == null ? 0 : (prev - 1 + gallery.length) % gallery.length));

  return (
    <section className="w-full bg-white py-8">
      <div className="max-w-screen-xl mx-auto px-4">
        <div className="mb-6 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-[#444]">Featured Products</h2>
          <div className="h-1 w-20 bg-[#8B1C1C] mx-auto mt-2" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {gallery.map((item, index) => {
            const img = getImageUrl(item.image);
            return (
              <button
                key={index}
                type="button"
                onClick={() => openAt(index)}
                className="group relative h-[420px] rounded-lg overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition text-left"
              >
                {img ? (
                  <img src={img} alt={item.title || `Featured product ${index + 1}`} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-200" />
                )}
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition" />
                <div className="absolute left-0 right-0 bottom-0 p-4 text-white">
                  <h3 className="text-lg font-semibold">{item.title || `Featured Product ${index + 1}`}</h3>
                  {item.description ? <p className="text-sm text-gray-100 mt-1 line-clamp-2">{item.description}</p> : null}
                </div>
              </button>
            );
          })}
        </div>

        {activeIndex !== null && gallery[activeIndex] ? (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4">
            <button type="button" onClick={close} className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 rounded px-3 py-1">
              Close
            </button>
            <button type="button" onClick={prev} className="absolute left-4 md:left-8 text-white bg-white/10 hover:bg-white/20 rounded px-3 py-2 text-xl">
              ←
            </button>
            <div className="w-full max-w-4xl">
              <img
                src={getImageUrl(gallery[activeIndex].image)}
                alt={gallery[activeIndex].title || `Featured product ${activeIndex + 1}`}
                className="w-full max-h-[75vh] object-contain rounded"
              />
              <div className="mt-3 text-center text-white">
                <h4 className="text-xl font-semibold">{gallery[activeIndex].title || `Featured Product ${activeIndex + 1}`}</h4>
                {gallery[activeIndex].description ? <p className="text-sm text-gray-200 mt-1">{gallery[activeIndex].description}</p> : null}
              </div>
              <div className="mt-4 flex justify-center gap-2">
                {gallery.map((_, dotIndex) => (
                  <button
                    key={dotIndex}
                    type="button"
                    onClick={() => setActiveIndex(dotIndex)}
                    className={`w-2.5 h-2.5 rounded-full ${dotIndex === activeIndex ? "bg-white" : "bg-white/40"}`}
                    aria-label={`Go to featured image ${dotIndex + 1}`}
                  />
                ))}
              </div>
            </div>
            <button type="button" onClick={next} className="absolute right-4 md:right-8 text-white bg-white/10 hover:bg-white/20 rounded px-3 py-2 text-xl">
              →
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ExploreSection({ items }: { items?: Array<any> }) {
  // fallback categories if none provided
  const categories = items && items.length ? items : [
    { title: "Doors", buttonText: "View More Products", image: "/aboutus.avif" },
    { title: "Enclosures", buttonText: "View More Products", image: "/sevices.avif" },
    { title: "Windows", buttonText: "View More Products", image: "/faqs.avif" },
    { title: "Railings", buttonText: "View More Products", image: "/Delivery&Ordering.avif" },
  ];

  return (
    <section className="w-full bg-white py-12">
      <div className="max-w-screen-xl mx-auto">
        <h2 className="text-5xl font-bold text-center text-[#444] mb-2">Explore Our Products</h2>
        <div className="h-1 w-20 bg-[#8B1C1C] mx-auto mb-6" />
        <p className="text-center text-xl italic text-[#444] mb-10">
          Explore innovative designs and durable materials<br />
          that redefine elegance in every space.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {categories.map((cat, i) => {
            const img = getImageUrl(cat.image);
            return (
              <div
                key={i}
                className="relative group h-[320px] md:h-[340px] rounded overflow-hidden flex items-center justify-center"
                style={{ minHeight: "320px" }}
              >
                {/* Background image */}
                {img ? (
                  <img
                    src={img}
                    alt={cat.title || ""}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gray-200" />
                )}
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition" />
                {/* Centered content */}
                <div className="relative z-10 flex flex-col items-center justify-center w-full h-full">
                  <h3 className="font-bold text-3xl md:text-4xl text-white mb-6 text-center drop-shadow">
                    {cat.title}
                  </h3>
                  <a
                    href={cat.buttonLink ?? "#"}
                    className="px-6 py-2 border-2 border-white text-white text-lg rounded bg-transparent hover:bg-white hover:text-[#8B1C1C] transition font-normal"
                  >
                    {cat.buttonText ?? "View More Products"}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}


// Featured Projects 
function FeaturedProjects({ projects }: { projects?: Array<any> }) {
  const list = projects && projects.length ? projects : [
    { title: "Project 1", image: "/project1.jpg", description: "Description for Project 1", youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { title: "Project 2", image: "/project2.jpg", description: "Description for Project 2", youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { title: "Project 3", image: "/project3.jpg", description: "Description for Project 3", youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  ];

  // Track which card is flipped
  const [flipped, setFlipped] = useState<number | null>(null); // no longer used for UI, kept to avoid runtime issues

  const getYoutubeEmbedUrl = (url?: string) => {
    if (!url) return null;

    try {
      // Handle full YouTube URLs like https://www.youtube.com/watch?v=ID
      const watchMatch = url.match(/[?&]v=([^&#]+)/);
      if (watchMatch?.[1]) {
        return `https://www.youtube.com/embed/${watchMatch[1]}`;
      }

      // Handle short URLs like https://youtu.be/ID
      const shortMatch = url.match(/youtu\.be\/([^&#?/]+)/);
      if (shortMatch?.[1]) {
        return `https://www.youtube.com/embed/${shortMatch[1]}`;
      }

      // Handle already-embed URLs
      const embedMatch = url.match(/youtube\.com\/embed\/([^&#?/]+)/);
      if (embedMatch?.[1]) {
        return `https://www.youtube.com/embed/${embedMatch[1]}`;
      }
    } catch {
      return null;
    }

    return null;
  };

  return (
    <section className="w-full bg-[#141821] py-12">
      <div className="max-w-screen-xl mx-auto">
        {/* Header row */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-8">
          <div>
            <h2 className="text-5xl font-bold text-white mb-2">Featured Projects</h2>
            <div className="h-2 w-56 bg-[#8B1C1C] mt-2" />
          </div>
          <a
            href="/Featured"
            className="bg-[#8B1C1C] text-white font-bold px-10 py-5 rounded text-lg mt-6 md:mt-0 shadow-lg hover:bg-[#a82c2c] transition"
          >
            VIEW MORE PROJECTS
          </a>
        </div>

        {/* List all featured projects vertically */}
        <div className="space-y-12">
          {list.map((p, i) => {
            const embedUrl = getYoutubeEmbedUrl(p.youtube_url || p.video_url || p.link_url);

            return (
              <article key={i} className="flex flex-col items-center text-center">
                {/* Video area */}
                <div className="w-full max-w-4xl aspect-video bg-black rounded overflow-hidden mb-4">
                  {embedUrl ? (
                    <iframe
                      src={embedUrl}
                      className="w-full h-full"
                      title={p.title || "Featured project video"}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                      No video available for this project.
                    </div>
                  )}
                </div>

                {/* Text content */}
                <h3 className="text-xl md:text-2xl font-semibold text-white mb-2">
                  {p.title}
                </h3>
                <p className="text-sm md:text-base text-gray-300 max-w-3xl">
                  {p.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ServicesSection({ services, about }: { services?: any; about?: any }) {
  const serv = services || {};
  const images: string[] = Array.isArray(serv.images) ? serv.images : [];
  const a = about || {};
  const logoUrl = a?.logo ? (a.logo.startsWith("http") ? a.logo : getImageUrl(a.logo)) : null;

  // selected index for main image (defaults to 0)
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // reset selected when images change
  useEffect(() => {
    setSelectedIndex(0);
  }, [images]);

  const mainImage = images[selectedIndex] || images[0] || null;

  return (
    <section className="w-full py-10 bg-white border-t relative">
      <div className="max-w-screen-xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 px-4 relative">
        {/* vertical + horizontal divider for desktop */}
        <div className="hidden md:block absolute top-0 bottom-0 left-1/2 w-1 bg-gray-300 z-10" />
        <div className="absolute left-0 right-0 top-1/2 h-1 bg-gray-300 z-10" />

        {/* Top-left: Service text (centered) */}
        <div className="order-1 md:order-1 flex items-center justify-center relative z-20 pr-4 pb-4">
          <div className="max-w-md text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-3 text-black">{serv.title ?? "Service We Offer"}</h2>
            <p className="text-gray-700 mb-5 leading-relaxed text-sm md:text-base">
              {serv.description ??
                "Grand East brings you top-tier aluminum and glass solutions, expertly crafted for both residential and commercial spaces. From sleek windows and doors to stunning facades, our services are designed to enhance both style and durability."}
            </p>
            <div className="mx-auto w-fit">
              {serv.buttonLink ? (
                <a href={serv.buttonLink} className="inline-block border border-black px-4 py-2 text-sm md:text-base font-medium text-black hover:bg-gray-100 transition">
                  {serv.buttonText ?? "Know More about Our Service"}
                </a>
              ) : (
                <button className="border border-black px-4 py-2 text-sm md:text-base font-medium text-black hover:bg-gray-100 transition">
                  {serv.buttonText ?? "Know More about Our Service"}
                </button>
              )}
            </div>
            {/* small accent line like the design */}
            <div className="mt-5 h-1 w-16 bg-red-600 mx-auto" />
          </div>
        </div>

        {/* Top-right: Images grid (click thumbnails to change main image) */}
        <div className="order-2 md:order-2 relative z-20 pr-4 pb-4">
          <div className="grid grid-cols-1 gap-3">
            {/* main image (smaller) */}
            <div className="w-full h-40 md:h-48 bg-gray-200 overflow-hidden flex items-center justify-center rounded">
              {mainImage ? (
                <img
                  src={mainImage.startsWith("http") ? mainImage : getImageUrl(mainImage)}
                  alt="Service main"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-gray-500 text-sm">Main Image</span>
              )}
            </div>

            {/* thumbnails row */}
            <div className="flex gap-2">
              {images.slice(0, 5).map((im: string, idx: number) => {
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedIndex(idx)}
                    className={`flex-1 h-14 md:h-16 overflow-hidden rounded focus:outline-none transition ${isSelected ? "ring-2 ring-red-600" : ""}`}
                    aria-pressed={isSelected}
                    type="button"
                  >
                    {im ? (
                      <img src={im.startsWith("http") ? im : getImageUrl(im)} alt={`thumb-${idx}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-100" />
                    )}
                  </button>
                );
              })}
              {/* fill empty slots if less than 5 thumbnails */}
              {Array.from({ length: Math.max(0, 5 - images.slice(0, 5).length) }).map((_, i) => (
                <div key={`empty-${i}`} className="flex-1 h-14 md:h-16 bg-gray-100 rounded" />
              ))}
            </div>
          </div>
        </div>

        {/* Bottom-left: Logo (kept size moderate) */}
        <div className="order-3 md:order-3 flex items-center justify-center relative z-20 pl-4 pt-4">
          <div className="w-full h-40 md:h-48 flex items-center justify-center bg-white overflow-hidden rounded shadow-sm p-3">
            {logoUrl ? <img src={logoUrl} alt="Logo" className="max-h-full object-contain" /> : <span className="text-gray-400 text-lg">LOGO IMAGE</span>}
          </div>
        </div>

        {/* Bottom-right: About card (dark) */}
        <div className="order-4 md:order-4 relative z-20 pr-4 pt-4">
          <div className="bg-[#0f2a44] text-white p-5 min-h-[160px] flex flex-col justify-between rounded">
            <div>
              <h3 className="text-xl md:text-2xl font-bold mb-2">{a.title ?? "ABOUT GRAND EAST"}</h3>
              <div className="h-1 w-12 bg-red-600 mb-3" />
              <p className="text-sm mb-4 leading-relaxed">
                {a.description ??
                  serv.aboutDescription ??
                  "At Grand East, we specialize in creating modern, durable, and stylish solutions that redefine residential and commercial spaces. With a passion for precision and a commitment to quality, our expert team delivers exceptional aluminum and glass installations that stand the test of time. Whether you're upgrading your home or transforming your business, we provide innovative designs that combine functionality with aesthetic appeal, ensuring your vision becomes a reality."}
              </p>
            </div>
            <div>
              {a.buttonLink ? (
                <a href={a.buttonLink} className="inline-block bg-red-600 text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 transition">
                  {a.buttonText ?? "VIEW MORE"}
                </a>
              ) : (
                <button className="inline-block bg-red-600 text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 transition">
                  {a.buttonText ?? "VIEW MORE"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AboutSection({ about }: { about?: any }) {
  const logo = about?.logo ? getImageUrl(about.logo) : null;
  return (
    <section className="w-full bg-[#0f2a44] py-8 text-white">
      <div className="max-w-screen-xl mx-auto px-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex-shrink-0 flex flex-col items-center md:items-end">
            <div className="relative">
              <a href="/contact" className="inline-flex items-center justify-center bg-[#8b1e1e] hover:bg-[#7a1a18] text-white px-8 py-3 rounded shadow-md font-semibold gap-3" aria-label="Inquire Now">
                <span>INQUIRE NOW</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3A2 2 0 0 1 9.2 3.08c.12.54.28 1.08.48 1.6a2 2 0 0 1-.45 2.11L8.7 8.7a16 16 0 0 0 6 6l1.91-1.04a2 2 0 0 1 2.11-.45c.52.2 1.06.36 1.6.48A2 2 0 0 1 22 16.92z" />
                </svg>
              </a>

              <a href="tel:+630000000000" className="absolute left-1/2 transform -translate-x-1/2 top-full mt-2 text-white underline text-sm">Call us</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


