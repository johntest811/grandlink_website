// app/products/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import { useRouter, useSearchParams } from "next/navigation";

// Helpers to normalize and match categories robustly
// This fixes issues where DB values may contain different spacing/casing/plurals
// Example: "Curtain Wall", "curtain-wall", "CurtainWalls" => all map to key "curtainwall"
function normalizeKey(s: string): string {
  return (s ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractProductCategoryKeys(p: any): string[] {
  const raw: string[] = [];
  // Common fields
  if (Array.isArray(p?.category)) raw.push(...p.category);
  else if (typeof p?.category === "string") raw.push(p.category);
  if (Array.isArray(p?.categories)) raw.push(...p.categories);
  else if (typeof p?.categories === "string") raw.push(p.categories);
  if (Array.isArray(p?.tags)) raw.push(...p.tags);
  if (typeof p?.type === "string") raw.push(p.type);

  // Support comma/pipe/slash-separated strings
  const parts = raw
    .flatMap((s) => (typeof s === "string" ? s.split(/[\,\|\/]+/) : []))
    .map((s) => s.trim())
    .filter(Boolean);

  // Normalize keys and compress common variants to canonical keys
  const keys = parts.map((s) => normalizeKey(s));
  const simplified = keys.map((k) => {
    if (k.includes("curtainwall") || (k.includes("curtain") && k.includes("wall"))) return "curtainwall";
    if (k.includes("enclosure")) return "enclosure";
    return k;
  });

  return Array.from(new Set(simplified));
}

function ProductsPageContent() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSideFilter, setShowSideFilter] = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch("/api/products");
        let data = await res.json();
        if (Array.isArray(data)) {
          setProducts(data);
        } else {
          setProducts([]);
          console.error("API did not return an array:", data);
        }
      } catch (err) {
        setProducts([]);
        console.error("Fetch error:", err);
      }
      setLoading(false);
    };
    fetchProducts();
  }, []);

  // Toggle side filter visibility based on scroll position (desktop only behavior)
  useEffect(() => {
    const onScroll = () => {
      // Show side filter after user scrolls past the category bar area
      const threshold = 260; // px; adjust if needed to match design height
      setShowSideFilter(window.scrollY > threshold);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // initialize
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileFilterOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileFilterOpen]);

  // Get unique categories from products
  const categories = [
    "All Products",
    "Doors",
    "Windows",
    "Enclosure",
    "Casement",
    "Sliding",
    "Railings",
    "Canopy",
    "Curtain Wall",
  ];

  const [selectedCategory, setSelectedCategory] = useState("All Products");

  // Set selected category from query param on mount / param change
  useEffect(() => {
    const param = searchParams?.get("category");
    if (param && categories.includes(param)) {
      setSelectedCategory(param);
    } else {
      setSelectedCategory("All Products");
    }
  }, [searchParams]);

  // when clicking category buttons update the url param
  const selectCategory = (cat: string) => {
    setSelectedCategory(cat);
    const url = new URL(window.location.href);
    if (cat === "All Products") {
      url.searchParams.delete("category");
    } else {
      url.searchParams.set("category", cat);
    }
    router.push(url.pathname + url.search);
  };

  // search state
  const [search, setSearch] = useState("");

  // Helper to get the first available image from product table
  const getProductImage = (prod: any) => {
    return (
      prod.image1 ||
      prod.image2 ||
      prod.image3 ||
      prod.image4 ||
      prod.image5 ||
      "https://placehold.co/400x300?text=No+Image"
    );
  };

  // Filter products by category + search + price range + stock (robust matching)
  const filteredProducts = products.filter((p) => {
    const selectedKey = normalizeKey(selectedCategory);
    const productKeys = extractProductCategoryKeys(p);

    const matchesCategory =
      selectedCategory === "All Products" ||
      // exact key match from normalized product category keys
      productKeys.includes(selectedKey) ||
      // Fallback: if no category data, try deducing from name/description
      (
        productKeys.length === 0 &&
        (normalizeKey(p?.name ?? "").includes(selectedKey) || normalizeKey(p?.description ?? "").includes(selectedKey))
      );

    const q = search.trim().toLowerCase();
    const inName = (p.name || "").toLowerCase().includes(q);
    const inDesc = (p.description || "").toLowerCase().includes(q);
    const inCategory =
      (p.category || "").toLowerCase().includes(q) ||
      (Array.isArray(p.categories) && p.categories.some((c: any) => (c ?? "").toString().toLowerCase().includes(q))) ||
      (Array.isArray(p.tags) && p.tags.some((t: any) => (t ?? "").toString().toLowerCase().includes(q)));

    const matchesSearch = !q || inName || inDesc || inCategory;

    // Price range filter
    const rawPrice = p.price;
    const numericPrice =
      typeof rawPrice === "number"
        ? rawPrice
        : rawPrice !== undefined && rawPrice !== null && rawPrice !== ""
        ? Number(rawPrice)
        : NaN;

    const hasMin = minPrice.trim() !== "";
    const hasMax = maxPrice.trim() !== "";

    let matchesPrice = true;

    if (hasMin || hasMax) {
      if (Number.isNaN(numericPrice)) {
        // if product has no valid price and user set a price filter, hide it
        matchesPrice = false;
      } else {
        const min = Number(minPrice);
        const max = Number(maxPrice);
        if (hasMin && !Number.isNaN(min) && numericPrice < min) matchesPrice = false;
        if (hasMax && !Number.isNaN(max) && numericPrice > max) matchesPrice = false;
      }
    }

    // Available stock filter (inventory > 0)
    const rawInventory = p.inventory;
    const numericInventory =
      typeof rawInventory === "number"
        ? rawInventory
        : rawInventory !== undefined && rawInventory !== null && rawInventory !== ""
        ? Number(rawInventory)
        : NaN;

    const matchesStock = !inStockOnly || (!Number.isNaN(numericInventory) && numericInventory > 0);

    return matchesCategory && matchesSearch && matchesPrice && matchesStock;
  });

  return (
    <div className="min-h-screen flex flex-col">
      <UnifiedTopNavBar />
      <main className={`flex-1 bg-white transition-[padding] duration-300 ${showSideFilter ? "lg:pl-60" : ""}`}>
        {/* Search bar */}
        <div className="py-6">
          <div className="max-w-6xl mx-auto px-4 flex justify-center text-black">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name, description or category..."
              className="w-full max-w-md border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>

        {/* Mobile / tablet filter trigger */}
        <section className="lg:hidden pb-3">
          <div className="max-w-6xl mx-auto px-4 flex items-center justify-between gap-3">
            <div className="text-xs text-gray-600">
              Category: <span className="font-semibold text-gray-800">{selectedCategory}</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileFilterOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:bg-gray-50"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-[#8B1C1C]" aria-hidden="true" />
              Open Filters
            </button>
          </div>
        </section>

        {/* Price range filter (applies to all layouts) */}
        <section className="hidden lg:block pb-2">
          <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center justify-center gap-4 text-sm text-black">
            <span className="font-medium">Price range:</span>
            <div className="flex items-center gap-2">
              <span>Min</span>
              <input
                type="number"
                min={0}
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="w-24 border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-red-600"
                placeholder="0"
              />
            </div>
            <div className="flex items-center gap-2">
              <span>Max</span>
              <input
                type="number"
                min={0}
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="w-24 border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-red-600"
                placeholder="No limit"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setMinPrice("");
                setMaxPrice("");
              }}
              className="text-xs text-gray-600 hover:text-red-600"
            >
              Clear price
            </button>

            {/* In-stock toggle */}
            <label className="flex items-center gap-2 cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-xs sm:text-sm">Only show items with available stock</span>
            </label>
          </div>
        </section>

        {/* Category Tabs */}
        <section className={`hidden lg:block py-6 border-b ${showSideFilter ? "lg:hidden" : ""}`}>
          <div className="flex flex-wrap justify-center gap-4 text-sm font-medium">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => selectCategory(cat)}
                className={`px-4 py-2 rounded transition ${
                  selectedCategory === cat
                    ? "text-red-600 border-b-2 border-red-600"
                    : "text-gray-700 hover:text-red-600"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>

        {/* Floating Left Sidebar Filter (shown after scrolling on large screens) */}
        <aside
          className={`hidden lg:block fixed left-5 top-28 z-40 transform transition-all duration-300 ease-out ${
            showSideFilter ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-3 pointer-events-none"
          }`}
          aria-hidden={!showSideFilter}
        >
          <div className="w-52 max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="bg-gradient-to-r from-[#8B1C1C] to-[#232d3b] px-4 py-3 text-white">
              <p className="text-sm font-semibold">Refine Products</p>
            </div>

            <div className="p-2.5">
              <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
                Active category: <span className="font-semibold text-gray-800">{selectedCategory}</span>
              </div>

              <div className="flex flex-col gap-1">
                {categories.map((cat) => {
                  const selected = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => selectCategory(cat)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] transition-all border ${
                        selected
                          ? "bg-red-50 text-red-700 border-red-300 shadow-sm"
                          : "bg-white hover:bg-gray-50 text-gray-700 border-transparent"
                      }`}
                      aria-pressed={selected}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 border-t pt-3 text-xs text-gray-700 flex flex-col gap-2.5">
                <div className="font-semibold uppercase tracking-wider text-gray-500">Price range</div>
                <div className="flex items-center justify-between gap-2">
                  <span>Min</span>
                  <input
                    type="number"
                    min={0}
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="w-20 border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-600"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Max</span>
                  <input
                    type="number"
                    min={0}
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="w-20 border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-600"
                  />
                </div>

                <label className="mt-1 flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => setInStockOnly(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>Only show available stock</span>
                </label>
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile/Tablet animated side filter drawer */}
        <div
          className={`lg:hidden fixed inset-0 z-50 transition-opacity duration-300 ${
            mobileFilterOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
          aria-hidden={!mobileFilterOpen}
        >
          <button
            type="button"
            onClick={() => setMobileFilterOpen(false)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close filters"
          />

          <aside
            className={`absolute left-0 top-0 h-full w-[min(22rem,92vw)] bg-white shadow-2xl transition-transform duration-300 ${
              mobileFilterOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="h-full overflow-y-auto">
              <div className="bg-gradient-to-r from-[#8B1C1C] to-[#232d3b] px-4 py-4 text-white flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Refine Products</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileFilterOpen(false)}
                  className="rounded bg-white/15 px-2.5 py-1 text-sm hover:bg-white/20"
                >
                  Close
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  Active category: <span className="font-semibold text-gray-800">{selectedCategory}</span>
                </div>

                <div className="space-y-1.5">
                  {categories.map((cat) => {
                    const selected = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => {
                          selectCategory(cat);
                          setMobileFilterOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-xl transition-all border ${
                          selected
                            ? "bg-red-50 text-red-700 border-red-300 shadow-sm"
                            : "bg-white hover:bg-gray-50 text-gray-700 border-transparent"
                        }`}
                        aria-pressed={selected}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>

                <div className="border-t pt-4 text-sm text-gray-700 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Price range</div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Min</span>
                    <input
                      type="number"
                      min={0}
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      className="w-28 border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-600"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Max</span>
                    <input
                      type="number"
                      min={0}
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      className="w-28 border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-600"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={inStockOnly}
                      onChange={(e) => setInStockOnly(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Only show available stock</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setMinPrice("");
                      setMaxPrice("");
                      setInStockOnly(false);
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Reset Filters
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* Product Grid */}
        <section className="py-10 max-w-6xl mx-auto px-4">
          {loading ? (
            <div className="text-center text-gray-500">Loading products...</div>
          ) : Array.isArray(filteredProducts) && filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
              {filteredProducts.map((prod) => (
                <Link
                  key={prod.id}
                  href={`/Product/details?id=${prod.id}`}
                  className="border p-2 rounded hover:shadow-lg transition block"
                >
                  {getProductImage(prod) && (
                    <Image
                      src={getProductImage(prod)}
                      alt={prod.name}
                      width={400}
                      height={300}
                      className="w-full h-40 object-cover rounded"
                    />
                  )}
                  <p className="mt-2 text-center text-base md:text-lg font-medium text-black">
                    {prod.name}
                  </p>
                  {/* small underline below product name */}
                  <div className="w-6 h-0.5 bg-red-600 mx-auto mt-1" aria-hidden="true" />

                  {/* Price and Inventory */}
                  <div className="mt-2 flex flex-col items-center text-sm text-gray-700">
                    <span>
                      <b>Price:</b> {prod.price !== undefined && prod.price !== null ? `₱${prod.price}` : "—"}
                    </span>
                    <span>
                      <b>Inventory:</b> {prod.inventory !== undefined && prod.inventory !== null ? prod.inventory : "—"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500">No products found.</div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading products...</div>}>
      <ProductsPageContent />
    </Suspense>
  );
}