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

function ProductDetailsPageContent() {
  const searchParams = useSearchParams();
  const productId = searchParams.get("id");
  const [product, setProduct] = useState<any>(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [show3D, setShow3D] = useState(false);
  const [weather, setWeather] = useState<"sunny" | "rainy" | "night" | "foggy">("sunny");
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
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

      const additionalfeatures = Array.isArray(data?.additionalfeatures)
        ? data.additionalfeatures.join("\n")
        : (data?.additionalfeatures ?? (data?.features?.length ? data.features.join("\n") : ""));

      setProduct({ ...data, additionalfeatures });
    };
    fetchProduct();
  }, [productId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id || null);
    });
  }, []);

  if (!product) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  const images: string[] = product.images?.length
    ? product.images
    : [product.image1, product.image2, product.image3, product.image4, product.image5].filter(Boolean);

  // Get FBX URLs - prioritize fbx_urls array, fallback to single fbx_url
  const fbxUrls: string[] = product.fbx_urls && Array.isArray(product.fbx_urls) && product.fbx_urls.length > 0
    ? product.fbx_urls.filter((url: string) => url && url.trim() !== '')
    : product.fbx_url ? [product.fbx_url] : [];

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
    setAdding(true);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          productId: product.id,
          quantity,
          meta: {
            selected_image: images[carouselIdx] || null,
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

  const isOutOfStock = product.inventory <= 0;
  const has3DModels = fbxUrls.length > 0;

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
                  {fbxUrls.length} 3D Model{fbxUrls.length > 1 ? 's' : ''} Available
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
              title={has3DModels ? `View ${fbxUrls.length} 3D Model${fbxUrls.length > 1 ? 's' : ''}` : "No 3D models available"}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
              </svg>
              <span>
                3D View {has3DModels && fbxUrls.length > 1 ? `(${fbxUrls.length})` : ''}
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
              <span>{isOutOfStock ? 'Out of Stock' : 'Reserve Now (₱500)'}</span>
            </button>
          </div>

          {/* Quantity Selector and Add to Cart Button */}
          <div className="flex items-center gap-4 mt-6">
            {/* Quantity Selector */}
            <div className="flex items-center border-2 border-gray-300 rounded-lg overflow-hidden shadow-sm hover:border-blue-400 transition-colors duration-200">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="px-5 py-3 bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-600 font-semibold transition-colors duration-200 border-r border-gray-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" />
                </svg>
              </button>
              <span className="px-8 py-3 text-lg font-bold text-gray-800 bg-white min-w-[60px] text-center">{quantity}</span>
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="px-5 py-3 bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-600 font-semibold transition-colors duration-200 border-l border-gray-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                </svg>
              </button>
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
              <p className="text-gray-800 text-sm md:text-base leading-relaxed">
                {product.description}
              </p>
            </div>

            <h4 className="text-red-700 font-bold mb-4 text-xl">Key Features</h4>

            {/* Dimensions & Material summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 p-3 rounded border flex flex-col items-center justify-center text-center">
                <div className="text-sm text-gray-500">Height</div>
                <div className="text-lg font-semibold text-gray-500">{product.height ?? "—"}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded border flex flex-col items-center justify-center text-center">
                <div className="text-sm text-gray-500">Width</div>
                <div className="text-lg font-semibold text-gray-500">{product.width ?? "—"}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded border flex flex-col items-center justify-center text-center">
                <div className="text-sm text-gray-500">Thickness</div>
                <div className="text-lg font-semibold text-gray-500">{product.thickness ?? "—"}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded border flex flex-col items-center justify-center text-center">
                <div className="text-sm text-gray-500">Material</div>
                <div className="text-lg font-semibold text-gray-500">{product.material ?? "Wood"}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded border col-span-2 sm:col-span-1 flex flex-col items-center justify-center text-center">
                <div className="text-sm text-gray-500">Type</div>
                <div className="text-lg font-semibold text-gray-500">{product.type ?? "Clear"}</div>
              </div>
            </div>

            <div className="mt-2">
              <h5 className="text-lg font-semibold text-red-700 mb-2">Additional Features</h5>
              <div className="text-lg text-gray-700 whitespace-pre-line">
                {product.additionalfeatures
                  ?? (product.features?.length ? product.features.join("\n") : "")
                }
              </div>
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

            <div className="flex-1 w-full min-h-0 relative overflow-hidden">
              <ThreeDFBXViewer
                fbxUrls={fbxUrls}
                weather={weather}
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