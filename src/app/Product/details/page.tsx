"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

const ThreeDFBXViewer = dynamic(() => import("./ThreeDFBXViewer"), { ssr: false });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripFeatureMarkup(value: string): string {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/ul>/gi, "\n")
      .replace(/<\/ol>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractFeatureItems(value: string): string[] {
  const seen = new Set<string>();
  const plainText = stripFeatureMarkup(value);
  if (!plainText) return [];

  return plainText
    .split(/\n+/)
    .map((item) => item.replace(/^[•\-\*\s]+/, "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeAdditionalFeaturesHtml(value: unknown): string {
  const source = Array.isArray(value)
    ? value.map((item) => String(item || "")).join("\n")
    : typeof value === "string"
    ? value
    : "";

  const items = extractFeatureItems(source);
  if (!items.length) return "";

  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

type ProductReview = {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

function formatReviewerLabel(userId: string): string {
  const raw = String(userId || "");
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      className={`h-4 w-4 ${filled ? "text-yellow-500" : "text-gray-300"}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.955a1 1 0 00.95.69h4.156c.969 0 1.371 1.24.588 1.81l-3.362 2.443a1 1 0 00-.364 1.118l1.286 3.955c.3.921-.755 1.688-1.54 1.118l-3.362-2.443a1 1 0 00-1.176 0l-3.362 2.443c-.784.57-1.838-.197-1.539-1.118l1.286-3.955a1 1 0 00-.364-1.118L2.07 9.382c-.783-.57-.38-1.81.588-1.81h4.156a1 1 0 00.951-.69l1.286-3.955z" />
    </svg>
  );
}

function ProductDetailsPageContent() {
  const searchParams = useSearchParams();
  const productId = searchParams.get("id");
  const [product, setProduct] = useState<any>(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [show3D, setShow3D] = useState(false);

  //Weather System
  const [weather, setWeather] = useState<"sunny" | "rainy" | "night" | "foggy">("sunny");
  const [frameFinish, setFrameFinish] = useState<"default" | "matteBlack" | "matteGray" | "narra" | "walnut">("default");
  const [quantityInput, setQuantityInput] = useState("1");
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [myReview, setMyReview] = useState<ProductReview | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const router = useRouter();

  // Prevent background page scroll while the 3D modal is open
  useEffect(() => {
    if (!show3D) return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    try {
      // Avoid layout shift when scrollbar disappears
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    } catch {}
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [show3D]);

  useEffect(() => {
    const fetchProduct = async () => {
      if (!productId) return;
      const res = await fetch(`/api/products?id=${productId}`);
      const data = await res.json();

      const additionalfeatures = normalizeAdditionalFeaturesHtml(
        data?.additionalfeatures ?? (data?.features?.length ? data.features : "")
      );

      setProduct({ ...data, additionalfeatures });
    };
    fetchProduct();
  }, [productId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id || null);
    });
  }, []);

  useEffect(() => {
    const loadReviews = async () => {
      if (!productId) return;
      setReviewsLoading(true);
      try {
        const res = await fetch(`/api/product-reviews?productId=${encodeURIComponent(productId)}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Failed to load reviews");
        setReviews(((payload?.reviews || []) as ProductReview[]) ?? []);
      } catch (err) {
        console.error("Failed to load reviews", err);
        setReviews([]);
      } finally {
        setReviewsLoading(false);
      }
    };

    void loadReviews();
  }, [productId]);

  useEffect(() => {
    const loadEligibilityAndMyReview = async () => {
      if (!productId) return;

      if (!userId) {
        setCanReview(false);
        setMyReview(null);
        setReviewComment("");
        setReviewRating(5);
        return;
      }

      setEligibilityLoading(true);
      try {
        const { data: completionRows, error: completionError } = await supabase
          .from("user_items")
          .select("id")
          .eq("user_id", userId)
          .eq("product_id", productId)
          .in("item_type", ["order", "reservation"])
          .or("order_status.eq.completed,status.eq.completed")
          .limit(1);

        if (completionError) throw completionError;
        setCanReview((completionRows || []).length > 0);

        const { data: existingReview, error: myReviewError } = await supabase
          .from("product_reviews")
          .select("id, product_id, user_id, rating, comment, created_at")
          .eq("product_id", productId)
          .eq("user_id", userId)
          .maybeSingle();

        if (myReviewError) throw myReviewError;
        setMyReview((existingReview as ProductReview) || null);
        if (existingReview) {
          setReviewRating(Number((existingReview as any).rating || 5));
          setReviewComment(String((existingReview as any).comment || ""));
        } else {
          setReviewRating(5);
          setReviewComment("");
        }
      } catch (err) {
        console.error("Failed to load review eligibility", err);
        setCanReview(false);
        setMyReview(null);
      } finally {
        setEligibilityLoading(false);
      }
    };

    void loadEligibilityAndMyReview();
  }, [productId, userId]);

  if (!product) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  const images: string[] = product.images?.length
    ? product.images
    : [product.image1, product.image2, product.image3, product.image4, product.image5].filter(Boolean);

  // Get 3D model URLs (FBX + GLB/GLTF, with backward-compatible field names)
  const modelUrls: string[] = (() => {
    const urls: string[] = [];

    const push = (v: any) => {
      if (Array.isArray(v)) {
        v.forEach((x) => {
          if (typeof x === "string" && x.trim()) urls.push(x.trim());
        });
      } else if (typeof v === "string" && v.trim()) {
        urls.push(v.trim());
      }
    };

    // Legacy + current fields
    push(product.fbx_urls);
    push(product.fbx_url);
    push((product as any).model_urls);
    push((product as any).model_url);
    push((product as any).glb_urls);
    push((product as any).glb_url);
    push((product as any).gltf_urls);
    push((product as any).gltf_url);

    // Dedupe while preserving order
    return Array.from(new Set(urls));
  })();

  const handlePrev = () => setCarouselIdx((idx) => (idx === 0 ? images.length - 1 : idx - 1));
  const handleNext = () => setCarouselIdx((idx) => (idx === images.length - 1 ? 0 : idx + 1));

  // Add to Wishlist with confirmation
  const handleAddToWishlist = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = (userData as any)?.user?.id;
    if (!userId) {
      if (window.confirm("Please log in to add to wishlist. Would you like to go to the login page?")) {
        router.push("/login");
      }
      return;
    }
    if (!window.confirm("Add this product to your wishlist?")) return;
    const { error } = await supabase
      .from("user_items")
      .insert([
        {
          user_id: userId,
          product_id: product.id,
          item_type: "my-list",
          status: "active",
          quantity: 1,
          created_at: new Date().toISOString(),
        },
      ]);
    if (error) {
      alert("Could not add to wishlist.");
      return;
    }
    router.push("/profile/my-list");
  };

  // Reserve Now - redirect to reservation form with product data
  const handleReserveNow = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = (userData as any)?.user?.id;
    if (!userId) {
      alert("Please log in to make a reservation.");
      return;
    }

    // Check inventory
    if (product.inventory <= 0) {
      alert("Sorry, this product is currently out of stock and cannot be reserved.");
      return;
    }

    // Redirect to reservation form with product ID
    router.push(`/reservation?productId=${product.id}`);
  };

  const handleAddToCart = async () => {
    if (!userId || !product) {
      if (window.confirm("Please sign in to add to cart. Would you like to go to the login page?")) {
        router.push("/login");
      }
      return;
    }

    const requestedQuantity = parsePositiveInteger(quantityInput);
    if (!requestedQuantity) {
      alert("Please enter a valid quantity.");
      setQuantityInput("1");
      return;
    }
    if (availableStock <= 0) {
      alert("This product is out of stock.");
      return;
    }
    if (requestedQuantity > availableStock) {
      alert(`Only ${availableStock} unit(s) available for ${product?.name || "this product"}.`);
      setQuantityInput(String(availableStock));
      return;
    }

    setAdding(true);
    try {
      const baseUnitPrice = Math.max(0, Number(product.price || 0));
      const baseWmm = Number(product.width || 0);
      const baseHmm = Number(product.height || 0);
      const baseWidthM = Number.isFinite(baseWmm) && baseWmm > 0 ? baseWmm / 1000 : undefined;
      const baseHeightM = Number.isFinite(baseHmm) && baseHmm > 0 ? baseHmm / 1000 : undefined;

      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          productId: product.id,
          quantity: requestedQuantity,
          meta: {
            selected_image: images[carouselIdx] || null,
            product_price: baseUnitPrice,
            custom_dimensions: {
              enabled: false,
              width: undefined,
              height: undefined,
            },
            pricing: {
              unit_price: baseUnitPrice,
              unit_price_per_sqm: baseUnitPrice,
              base_width_mm: Number.isFinite(baseWmm) && baseWmm > 0 ? baseWmm : undefined,
              base_height_mm: Number.isFinite(baseHmm) && baseHmm > 0 ? baseHmm : undefined,
              custom_width_m: baseWidthM,
              custom_height_m: baseHeightM,
            },
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to add to cart");
      router.push("/profile/cart");
    } catch (error: any) {
      alert(error.message);
    } finally {
      setAdding(false);
    }
  };

  const availableStock = Math.max(0, Number(product?.inventory ?? 0));
  const isOutOfStock = availableStock <= 0;
  const has3DModels = modelUrls.length > 0;
  const averageRating = reviews.length
    ? reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length
    : 0;

  const handleQuantityInputChange = (rawValue: string) => {
    const digitsOnly = rawValue.replace(/[^\d]/g, "");
    if (!digitsOnly) {
      setQuantityInput("");
      return;
    }

    const parsed = parsePositiveInteger(digitsOnly);
    if (!parsed) {
      setQuantityInput("1");
      return;
    }

    if (availableStock > 0 && parsed > availableStock) {
      alert(`Only ${availableStock} unit(s) available for ${product?.name || "this product"}.`);
      setQuantityInput(String(availableStock));
      return;
    }

    setQuantityInput(String(parsed));
  };

  const normalizeQuantityInput = () => {
    const parsed = parsePositiveInteger(quantityInput);
    if (!parsed) {
      setQuantityInput("1");
      return;
    }

    if (availableStock > 0 && parsed > availableStock) {
      alert(`Only ${availableStock} unit(s) available for ${product?.name || "this product"}.`);
      setQuantityInput(String(availableStock));
      return;
    }

    setQuantityInput(String(parsed));
  };

  const submitReview = async () => {
    if (!productId) return;
    if (!userId) {
      if (window.confirm("Please sign in to leave a review. Go to login?")) {
        router.push("/login");
      }
      return;
    }
    if (!canReview) {
      alert("Only users who have completed this product can leave a review.");
      return;
    }

    const rating = Math.max(1, Math.min(5, Number(reviewRating || 5)));
    const trimmed = reviewComment.trim();
    const commentOrNull = trimmed ? trimmed : null;

    setSubmittingReview(true);
    try {
      const { error } = await supabase
        .from("product_reviews")
        .upsert(
          [{ product_id: productId, user_id: userId, rating, comment: commentOrNull }],
          { onConflict: "product_id,user_id" }
        );
      if (error) throw error;

      const { data: refreshed, error: refreshError } = await supabase
        .from("product_reviews")
        .select("id, product_id, user_id, rating, comment, created_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });
      if (refreshError) throw refreshError;
      setReviews((refreshed || []) as ProductReview[]);

      const { data: existingReview } = await supabase
        .from("product_reviews")
        .select("id, product_id, user_id, rating, comment, created_at")
        .eq("product_id", productId)
        .eq("user_id", userId)
        .maybeSingle();
      setMyReview((existingReview as ProductReview) || null);

      alert(myReview ? "Review updated." : "Review submitted.");
    } catch (err: any) {
      console.error("Failed to submit review", err);
      alert(err?.message || "Failed to submit review.");
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <UnifiedTopNavBar />
      <div className="flex-1 flex flex-col items-center py-10 bg-white">
        <div className="w-full max-w-4xl xl:max-w-6xl bg-white rounded shadow p-12">
          {/* Back Button */}
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-600 hover:text-red-600 font-medium transition-colors duration-200 mb-6 group"
          >
            <svg 
              className="w-5 h-5 transition-transform duration-200 group-hover:-translate-x-1" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M10 19l-7-7m0 0l7-7m-7 7h18" 
              />
            </svg>
            <span>Back</span>
          </button>

          {/* Carousel */}
          <div className="relative flex flex-col items-center">
            {/* Main image container - keep aspect and fit */}
            <div className="relative w-full h-[36rem] bg-gray-100 rounded overflow-hidden">
              <Image
                src={images[carouselIdx] || "https://placehold.co/1200x700/png?text=No+Image"}
                alt={product.name || "Product image"}
                fill
                priority
                unoptimized
                quality={95}
                sizes="(max-width: 768px) 100vw, 1200px"
                className="object-contain"
              />
            </div>
            {/* Arrow buttons */}
            <button
              className="absolute left-2 top-1/2 -translate-y-1/2 text-black hover:text-red-600 px-2 py-2 rounded-full transition flex items-center justify-center"
              style={{ background: "none", zIndex: 2 }}
              onClick={handlePrev}
              aria-label="Previous"
            >
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <path d="M24 14L18 20L24 26" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-black hover:text-red-600 px-2 py-2 rounded-full transition flex items-center justify-center"
              style={{ background: "none", zIndex: 2 }}
              onClick={handleNext}
              aria-label="Next"
            >
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <path d="M16 14L22 20L16 26" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {/* Thumbnails - horizontal scroll with snap and no shrink so they stay inside viewport */}
            <div className="w-full mt-4 overflow-x-auto py-2">
              <div className="flex gap-3 px-2 snap-x snap-mandatory">
                {images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCarouselIdx(idx)}
                    className={`relative w-24 h-24 flex-shrink-0 snap-center rounded-lg overflow-hidden border transition-shadow ${
                      carouselIdx === idx ? "border-red-600 shadow-md" : "border-gray-300 hover:shadow"
                    }`}
                    aria-label={`Show image ${idx + 1}`}
                  >
                    <Image
                      src={img || "https://placehold.co/200x200/png?text=No+Image"}
                      alt={`Thumbnail ${idx + 1}`}
                      fill
                      unoptimized
                      quality={90}
                      sizes="96px"
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Product Info */}
          <div className="mt-10">
            <h2 className="text-4xl font-bold text-black">{product.name}</h2>

            <div className="mt-2 flex items-center gap-2 text-sm text-gray-700">
              <div className="flex items-center gap-0.5" aria-label={`${averageRating.toFixed(1)} out of 5`}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} filled={averageRating >= i + 1} />
                ))}
              </div>
              <span className="font-semibold">{averageRating ? averageRating.toFixed(1) : "0.0"}</span>
              <span className="text-gray-500">({reviews.length} review{reviews.length === 1 ? "" : "s"})</span>
            </div>

            {product.fullproductname && (
              <div className="text-2xl text-gray-600 mt-1">{product.fullproductname}</div>
            )}

            <h3 className="text-2xl font-semibold text-gray-600 mt-2">{product.subtitle || product.series}</h3>
            
            {/* Stock Status */}
            <div className="mt-4">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                isOutOfStock 
                  ? 'bg-red-100 text-red-800' 
                  : product.inventory <= 5 
                    ? 'bg-yellow-100 text-yellow-800' 
                    : 'bg-green-100 text-green-800'
              }`}>
                {isOutOfStock 
                  ? 'Out of Stock' 
                  : `${product.inventory} in stock`
                }
              </span>
              {product.price && (
                <span className="ml-4 text-2xl font-bold text-green-600">
                  ₱{product.price.toLocaleString()}
                </span>
              )}
            </div>

            {/* 3D Models Info */}
            {has3DModels && (
              <div className="mt-3">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                  {modelUrls.length} 3D Model{modelUrls.length > 1 ? 's' : ''} Available
                </span>
              </div>
            )}
          </div>
          
          {/* Actions */}
          <div className="flex flex-wrap gap-4 mt-10">
            {/* 3D View Button */}
            <button
              disabled={!has3DModels}
              onClick={() => setShow3D(true)}
              className={`group relative flex items-center gap-3 px-8 py-4 rounded-lg font-semibold text-base shadow-lg transition-all duration-300 transform ${
                has3DModels
                  ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 hover:shadow-xl hover:scale-105 active:scale-95"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed shadow-md"
              }`}
              title={has3DModels ? `View ${modelUrls.length} 3D Model${modelUrls.length > 1 ? 's' : ''}` : "No 3D models available"}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
              </svg>
              <span>
                3D View {has3DModels && modelUrls.length > 1 ? `(${modelUrls.length})` : ''}
              </span>
            </button>
            
            {/* Add to Wishlist Button */}
            <button
              onClick={handleAddToWishlist}
              className="group relative flex items-center gap-3 px-8 py-4 rounded-lg font-semibold text-base bg-gradient-to-r from-pink-500 to-red-500 text-white shadow-lg hover:from-pink-600 hover:to-red-600 hover:shadow-xl transition-all duration-300 transform hover:scale-105 active:scale-95"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
              </svg>
              <span>Add to Wishlist</span>
            </button>
            
            {/* Reserve Now Button */}
            <button
              onClick={handleReserveNow}
              disabled={isOutOfStock}
              className={`group relative flex items-center gap-3 px-10 py-4 rounded-lg font-bold text-lg shadow-lg transition-all duration-300 transform ${
                isOutOfStock
                  ? 'bg-gray-400 text-white cursor-not-allowed shadow-md'
                  : 'bg-gradient-to-r from-red-600 to-red-700 text-white hover:from-red-700 hover:to-red-800 hover:shadow-xl hover:scale-105 active:scale-95'
              }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <span>{isOutOfStock ? 'Out of Stock' : 'Reserve Now'}</span>
            </button>
          </div>

          {/* Quantity Selector and Add to Cart Button */}
          <div className="flex items-center gap-4 mt-6">
            {/* Quantity Selector */}
            <div className="flex items-center gap-3 border-2 border-gray-300 rounded-lg px-4 py-2 shadow-sm hover:border-blue-400 transition-colors duration-200 bg-white">
              <label className="text-sm font-semibold text-gray-700">Qty</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={quantityInput}
                onChange={(event) => handleQuantityInputChange(event.target.value)}
                onBlur={normalizeQuantityInput}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                  }
                  if (event.key === "e" || event.key === "E" || event.key === "+" || event.key === "-" || event.key === ".") {
                    event.preventDefault();
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                className="w-24 rounded border border-gray-300 px-3 py-2 text-center text-lg font-bold text-gray-800 outline-none focus:border-blue-500"
                aria-label="Quantity"
              />
              <span className="text-xs text-gray-500">Stock: {availableStock}</span>
            </div>
            
            {/* Add to Cart Button */}
            <button
              onClick={handleAddToCart}
              disabled={adding || isOutOfStock}
              className={`flex items-center gap-3 px-8 py-3 rounded-lg font-semibold text-base shadow-lg transition-all duration-300 transform ${
                adding || isOutOfStock
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-gradient-to-r from-green-600 to-green-700 text-white hover:from-green-700 hover:to-green-800 hover:shadow-xl hover:scale-105 active:scale-95'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span>{adding ? "Adding..." : isOutOfStock ? "Out of Stock" : "Add to Cart"}</span>
            </button>
          </div>

          {/* Key Features */}
          <div className="mt-12 border-t pt-8">
            <div className="mb-6">
              <label className="block text-lg font-semibold text-gray-700 mb-2">Product Description</label>
              <div
                className="blog-content text-gray-800 text-sm md:text-base leading-relaxed"
                dangerouslySetInnerHTML={{ __html: product.description || "" }}
              />
            </div>

            <h4 className="text-red-700 font-bold mb-4 text-xl">Key Features</h4>

            {/* Dimensions summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 p-3 rounded border flex flex-col items-center justify-center text-center">
                <div className="text-sm text-gray-500">Height</div>
                <div className="text-lg font-semibold text-gray-500">
                  {product.height != null ? `${product.height} mm` : "—"}
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded border flex flex-col items-center justify-center text-center">
                <div className="text-sm text-gray-500">Width</div>
                <div className="text-lg font-semibold text-gray-500">
                  {product.width != null ? `${product.width} mm` : "—"}
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded border flex flex-col items-center justify-center text-center">
                <div className="text-sm text-gray-500">Thickness</div>
                <div className="text-lg font-semibold text-gray-500">
                  {product.thickness != null ? `${product.thickness} mm` : "—"}
                </div>
              </div>
            </div>

            <div className="mt-2">
              <h5 className="text-lg font-semibold text-red-700 mb-2">Additional Features</h5>
              <div
                className="blog-content text-lg text-gray-700"
                dangerouslySetInnerHTML={{
                  __html: product.additionalfeatures || "",
                }}
              />
            </div>
          </div>

          {/* Reviews */}
          <div className="mt-12 border-t pt-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h4 className="text-red-700 font-bold text-xl">Reviews</h4>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex items-center gap-0.5" aria-label={`Average rating ${averageRating.toFixed(1)} out of 5`}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} filled={averageRating >= i + 1 - 0.25} />
                    ))}
                  </div>
                  <div className="text-sm text-gray-600">
                    {reviews.length ? `${averageRating.toFixed(1)} / 5 (${reviews.length})` : "No reviews yet"}
                  </div>
                </div>
              </div>

              {reviewsLoading && (
                <div className="text-sm text-gray-500">Loading reviews…</div>
              )}
            </div>

            {/* Leave a review */}
            <div className="mt-6 rounded-lg border bg-gray-50 p-4">
              <div className="text-sm font-semibold text-gray-900">Leave a review</div>
              {!userId ? (
                <div className="mt-2 text-sm text-gray-600">
                  Please <Link href="/login" className="text-red-700 underline">sign in</Link> to leave a review.
                </div>
              ) : eligibilityLoading ? (
                <div className="mt-2 text-sm text-gray-500">Checking eligibility…</div>
              ) : !canReview ? (
                <div className="mt-2 text-sm text-gray-600">
                  Only users who have completed this product can leave a review.
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm text-gray-700">Rating</label>
                    <select
                      value={reviewRating}
                      onChange={(e) => setReviewRating(Number(e.target.value))}
                      className="rounded border bg-white px-3 py-2 text-sm text-black"
                    >
                      {[5, 4, 3, 2, 1].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    {myReview && (
                      <span className="text-xs text-gray-500">You already reviewed this product (editing will update it).</span>
                    )}
                  </div>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    className="w-full rounded border bg-white px-3 py-2 text-sm text-black"
                    placeholder="Optional comment (max 2000 chars)"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-gray-500">{reviewComment.trim().length}/2000</div>
                    <button
                      type="button"
                      onClick={submitReview}
                      disabled={submittingReview}
                      className="rounded bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {submittingReview ? "Submitting…" : myReview ? "Update Review" : "Submit Review"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Reviews list */}
            <div className="mt-6 space-y-3">
              {(!reviewsLoading && reviews.length === 0) && (
                <div className="text-sm text-gray-500">No reviews yet. Be the first!</div>
              )}
              {reviews.map((review) => (
                <div key={review.id} className="rounded-lg border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5`}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} filled={Number(review.rating || 0) >= i + 1} />
                        ))}
                      </div>
                      <div className="text-xs text-gray-500">by {formatReviewerLabel(review.user_id)}</div>
                    </div>
                    <div className="text-xs text-gray-500">{new Date(review.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{review.comment}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <Footer />

      {/* 3D Viewer Modal */}
      {show3D && has3DModels && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-6xl max-h-[90vh] bg-white rounded-lg shadow-lg p-4 relative flex flex-col">
            {/* Stylish Circular Close Button */}
            <button
              className="absolute top-6 right-6 z-20 group w-12 h-12 bg-white/90 backdrop-blur-sm hover:bg-white border border-gray-200 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-110 hover:shadow-xl flex items-center justify-center"
              onClick={() => setShow3D(false)}
              aria-label="Close 3D viewer"
            >
              {/* X Icon */}
              <svg 
                className="w-5 h-5 text-gray-600 group-hover:text-red-500 transition-colors duration-300" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2.5} 
                  d="M6 18L18 6M6 6l12 12" 
                />
              </svg>
              
              {/* Subtle hover ring effect */}
              <div className="absolute inset-0 rounded-full border-2 border-transparent group-hover:border-red-200 transition-all duration-300 scale-110 opacity-0 group-hover:opacity-100"></div>
            </button>

            {/* Weather Controls - Fixed to modal frame */}
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-20 flex gap-2">
              {["sunny", "rainy", "night", "foggy"].map((w) => (
                <button
                  key={w}
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                    weather === w 
                      ? "bg-black text-white" 
                      : "bg-gray-200 text-black hover:bg-gray-300"
                  }`}
                  onClick={() => setWeather(w as any)}
                  aria-label={w}
                >
                  {w.charAt(0).toUpperCase() + w.slice(1)}
                </button>
              ))}
            </div>

            {/* Frame Color Controls - Fixed to modal frame (non-moving) */}
            <div className="absolute top-20 right-6 z-20 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-2 shadow-sm">
              <div className="text-xs font-semibold text-gray-700 mb-2">Frame</div>
              {/* ENDS HERE */}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  title="Default"
                  aria-label="Default"
                  onClick={() => setFrameFinish("default")}
                  className={
                    "px-3 py-2 rounded-md text-xs font-medium border transition-all text-left text-black " +
                    (frameFinish === "default" ? "border-black bg-white" : "border-gray-300 bg-white hover:border-gray-400")
                  }
                >
                  Default
                </button>
                {(
                  [
                    { key: "matteBlack", label: "Matte Black", swatchClass: "bg-black" },
                    { key: "matteGray", label: "Matte Gray", swatchClass: "bg-gray-500" },
                    { key: "narra", label: "Narra", swatchClass: "bg-amber-800" },
                    { key: "walnut", label: "Walnut", swatchClass: "bg-stone-700" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    title={opt.label}
                    aria-label={opt.label}
                    onClick={() => setFrameFinish(opt.key)}
                    className={
                      "flex items-center gap-2 px-2 py-2 rounded-md border transition-all " +
                      (frameFinish === opt.key ? "border-black bg-white" : "border-gray-300 bg-white hover:border-gray-400")
                    }
                  >
                    <span className={`w-5 h-5 rounded-full border border-black/10 ${opt.swatchClass}`} />
                    <span className="text-xs font-medium text-gray-800">{opt.label}</span>
                  </button>
                ))}
              </div>

            </div>

            <div className="flex-1 w-full min-h-0 relative overflow-hidden">
              <ThreeDFBXViewer
                modelUrls={modelUrls}
                weather={weather}
                frameFinish={frameFinish}
                productCategory={product?.category ?? product?.type ?? null}
                skyboxes={product?.skyboxes || null}
                productDimensions={{
                  width: product.width,
                  height: product.height,
                  thickness: product.thickness,
                  // If your DB values are in cm or m, change this default.
                  units: "mm",
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductDetailsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading product...</div>}>
      <ProductDetailsPageContent />
    </Suspense>
  );
}