"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSearchParams, useRouter } from "next/navigation";
import { FaArrowLeft, FaShoppingCart } from "react-icons/fa";
import { computeMeasurementPricing } from "../../../../utils/measurementPricing";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type UserItem = {
  id: string;
  product_id: string;
  quantity: number;
  meta: any;
  price?: number;
};

type Product = {
  id: string;
  name?: string;
  price?: number;
  images?: string[];
  image1?: string;
  inventory?: number;
  width?: number;
  height?: number;
};

type Address = {
  id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  phone?: string;
  address?: string;
  is_default: boolean;
};

type VoucherInfo = { code: string; type: "percent" | "amount"; value: number };

function CartCheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const itemIdsParam = searchParams.get("items");

  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<UserItem[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"delivery" | "pickup">("delivery");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<VoucherInfo | null>(null);
  const [applyingVoucher, setApplyingVoucher] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"payrex" | "paypal">("payrex");
  const [payrexPhone, setPayrexPhone] = useState("");

  const branches = [
    "BALINTAWAK BRANCH",
    "STA. ROSA BRANCH",
    "UGONG BRANCH",
    "ALABANG SHOWROOM",
    "IMUS BRANCH",
    "PAMPANGA SHOWROOM",
    "HIHOME BRANCH",
    "MC HOME DEPO ORTIGAS",
    "SAN JUAN CITY",
    "CW COMMONWEALTH",
    "MC HOME DEPO BGC",
  ];

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) {
          router.push("/login");
          return;
        }
        const uid = userData.user.id;
        setUserId(uid);

        // Parse item IDs from query string
        const itemIds = itemIdsParam ? itemIdsParam.split(",") : [];
        if (itemIds.length === 0) {
          alert("No items selected");
          router.push("/profile/cart");
          return;
        }

        // Load cart items from cart table
        const { data: cartData, error: cartError } = await supabase
          .from("cart")
          .select("*")
          .eq("user_id", uid)
          .in("id", itemIds);

        if (cartError) throw cartError;
        setItems(cartData as any || []);

        // Load products
        const productIds = Array.from(new Set(cartData?.map((item: any) => item.product_id) || []));
        if (productIds.length > 0) {
          const { data: prodData } = await supabase
            .from("products")
            .select("id, name, price, images, image1, inventory, width, height")
            .in("id", productIds);

          const map: Record<string, Product> = {};
          (prodData || []).forEach((p: any) => {
            map[p.id] = p;
          });
          setProducts(map);
        }

        // Load addresses
        const { data: addressData } = await supabase
          .from("addresses")
          .select("*")
          .eq("user_id", uid)
          .order("is_default", { ascending: false });

        if (addressData) {
          setAddresses(addressData as any);
          const def = addressData.find((a: any) => a.is_default);
          if (def) setSelectedAddressId(def.id);
        }
      } catch (e) {
        console.error(e);
        alert("Error loading checkout data");
        router.push("/profile/cart");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [itemIdsParam, router]);

  useEffect(() => {
    const loadPaymentSettings = async () => {
      try {
        const res = await fetch("/api/home");
        if (!res.ok) return;
        const data = await res.json();
        const content = data?.content ?? data ?? {};
        const configured = String(content?.payment?.payrex_phone || content?.payment?.payrex_number || "").trim();
        setPayrexPhone(configured);
      } catch (err) {
        console.warn("Failed to load payment settings", err);
      }
    };

    loadPaymentSettings();
  }, []);

  const computeUnitPrice = (item: UserItem) => {
    const product = products[item.product_id];
    const unitPricePerSqm = Number(product?.price ?? 0);

    const baseWmm = Number((product as any)?.width ?? 0);
    const baseHmm = Number((product as any)?.height ?? 0);
    const baseWidthM = Number.isFinite(baseWmm) && baseWmm > 0 ? baseWmm / 1000 : undefined;
    const baseHeightM = Number.isFinite(baseHmm) && baseHmm > 0 ? baseHmm / 1000 : undefined;

    const customWidth = item.meta?.custom_dimensions?.width;
    const customHeight = item.meta?.custom_dimensions?.height;

    const widthMeters = customWidth ?? baseWidthM;
    const heightMeters = customHeight ?? baseHeightM;

    const perPanelPrice = (item.meta as any)?.custom_dimensions?.per_panel_price ?? (item.meta as any)?.pricing?.per_panel_price;
    const addedPanels = (item.meta as any)?.custom_dimensions?.added_panels ?? (item.meta as any)?.pricing?.added_panels;

    const pricing = computeMeasurementPricing({
      widthMeters,
      heightMeters,
      unitPricePerSqm,
      minSqm: 1,
      sqmDecimals: 2,
      perPanelPrice,
      addedPanels,
    });

    return pricing.unit_price;
  };

  const setItemMeasurementLocal = (itemId: string, width: string, height: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          meta: {
            ...(it.meta || {}),
            custom_dimensions: {
              ...(it.meta?.custom_dimensions || {}),
              width: width,
              height: height,
            },
          },
        };
      })
    );
  };

  const persistItemMeasurement = async (itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;

    const rawW = item.meta?.custom_dimensions?.width;
    const rawH = item.meta?.custom_dimensions?.height;
    const w = rawW === "" || rawW == null ? null : Number(rawW);
    const h = rawH === "" || rawH == null ? null : Number(rawH);

    // Allow empty to mean "use default product measurement".
    // If provided, enforce positive finite meters.
    if ((w != null && (!Number.isFinite(w) || w <= 0)) || (h != null && (!Number.isFinite(h) || h <= 0))) {
      alert("Please enter valid Width/Height in meters (greater than 0).\nLeave blank to use default size.");
      return;
    }

    const nextMeta = {
      ...(item.meta || {}),
      custom_dimensions: {
        ...(item.meta?.custom_dimensions || {}),
        width: w ?? undefined,
        height: h ?? undefined,
      },
    };

    try {
      const res = await fetch("/api/cart", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, meta: nextMeta }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to update measurement");
      // Update local with canonical meta from server.
      setItems((prev) => prev.map((it) => (it.id === itemId ? (json.item as any) : it)));
    } catch (e: any) {
      alert(e?.message || "Failed to update measurement");
    }
  };

  const totals = useMemo(() => {
    const base = items.reduce(
      (acc, item) => {
        const product = products[item.product_id];
        const unitPrice = computeUnitPrice(item);
        const quantity = Number(item.quantity || 1);
        const addons = Array.isArray(item.meta?.addons)
          ? item.meta.addons.reduce((sum: number, addon: any) => sum + Number(addon?.fee || 0), 0)
          : 0;
        const baseLine = unitPrice * quantity;
        const addonLine = addons * quantity;
        acc.subtotal += baseLine;
        acc.addons += addonLine;
        return acc;
      },
      { subtotal: 0, addons: 0 }
    );
    let preDiscount = base.subtotal + base.addons;
    let discount = 0;
    if (voucherInfo) {
      discount = voucherInfo.type === 'percent'
        ? preDiscount * (voucherInfo.value / 100)
        : voucherInfo.value;
      discount = Math.min(discount, preDiscount);
    }
    const reservationFee = items.length > 0 ? 500 : 0;
    const total = Math.max(0, preDiscount - discount + reservationFee);
    return { ...base, discount, reservationFee, total };
  }, [items, products, voucherInfo]);

  const applyVoucher = async () => {
    if (items.length === 0) return alert("No items to apply voucher");
    setApplyingVoucher(true);
    try {
      const preDiscount = totals.subtotal + totals.addons;
      const res = await fetch("/api/discount-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: voucherCode.trim(), subtotal: preDiscount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Invalid code");
      setVoucherInfo(data.discount);
      alert("Voucher applied successfully!");
    } catch (error: any) {
      alert(error.message);
      setVoucherInfo(null);
    } finally {
      setApplyingVoucher(false);
    }
  };

  const handleCheckout = async () => {
    if (!userId) {
      alert("Please sign in");
      return;
    }
    if (fulfillmentMethod === "delivery" && !selectedAddressId) {
      alert("Please select a delivery address");
      return;
    }
    if (fulfillmentMethod === "pickup" && !selectedBranch) {
      alert("Please select a pickup branch");
      return;
    }
    if (items.length === 0) {
      alert("No items to checkout");
      return;
    }

    setSubmitting(true);
    try {
      // Generate a unique receipt reference to scope items for the success page
      const receiptRef = `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Create payment session with cart items
      // Pass metadata about address and branch
      const res = await fetch("/api/create-payment-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_ids: items.map(item => item.id),
          user_id: userId,
          payment_method: paymentMethod,
          payment_type: "reservation",
          delivery_address_id: fulfillmentMethod === "delivery" ? selectedAddressId : null,
          branch: fulfillmentMethod === "pickup" ? selectedBranch : null,
          delivery_method: fulfillmentMethod,
          // Include the receipt ref in the success URL so we can fetch only these items later
          success_url: `${window.location.origin}/profile/cart/success?source=cart&ref=${encodeURIComponent(receiptRef)}`,
          cancel_url: `${window.location.origin}/profile/cart/checkout?items=${itemIdsParam}`,
          voucher: voucherInfo || undefined,
          // Also pass the ref so the server can store it in metadata and on each user_item
          receipt_ref: receiptRef,
        })
      });

      const json = await res.json();
      if (!res.ok || !json.checkoutUrl) {
        throw new Error(json.error || "Checkout failed");
      }

      // Redirect to payment
      window.location.href = json.checkoutUrl;
    } catch (error: any) {
      console.error("Checkout error:", error);
      alert(error.message || "Checkout failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B1C1C] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading checkout...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push("/profile/cart")}
            className="flex items-center gap-2 text-[#8B1C1C] hover:underline"
          >
            <FaArrowLeft /> Back to Cart
          </button>
          <h1 className="text-3xl font-bold text-gray-900 mt-4 flex items-center gap-3">
            <FaShoppingCart className="text-[#8B1C1C]" />
            Checkout
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Forms */}
          <div className="lg:col-span-2 space-y-6">
            {/* Reservation Details */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 border-b pb-3">
                Reservation Details
              </h2>

              {/* Fulfillment Method */}
              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Fulfillment Method <span className="text-red-600">*</span>
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 cursor-pointer">
                    <input
                      type="radio"
                      name="fulfillment"
                      checked={fulfillmentMethod === "delivery"}
                      onChange={() => setFulfillmentMethod("delivery")}
                    />
                    <span className="text-gray-900 font-medium">Delivery</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 cursor-pointer">
                    <input
                      type="radio"
                      name="fulfillment"
                      checked={fulfillmentMethod === "pickup"}
                      onChange={() => setFulfillmentMethod("pickup")}
                    />
                    <span className="text-gray-900 font-medium">Pickup</span>
                  </label>
                </div>
              </div>

              {/* Delivery Address */}
              {fulfillmentMethod === "delivery" && (
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Delivery Address <span className="text-red-600">*</span>
                </label>
                <select
                  value={selectedAddressId}
                  onChange={(e) => setSelectedAddressId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-[#8B1C1C] focus:border-transparent"
                  required
                >
                  <option value="">Select Address</option>
                  {addresses.map((addr) => (
                    <option key={addr.id} value={addr.id}>
                      {addr.full_name} - {addr.address} {addr.phone && `(${addr.phone})`}
                      {addr.is_default && " (Default)"}
                    </option>
                  ))}
                </select>
                {addresses.length === 0 && (
                  <p className="text-sm text-gray-500 mt-2">
                    No addresses found.{" "}
                    <a href="/profile/address" className="text-[#8B1C1C] hover:underline">
                      Add an address
                    </a>
                  </p>
                )}
              </div>
              )}

              {/* Pickup Branch */}
              {fulfillmentMethod === "pickup" && (
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Branch <span className="text-red-600">*</span>
                </label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-[#8B1C1C] focus:border-transparent"
                  required
                >
                  <option value="">Select Branch</option>
                  {branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </div>
              )}
            </div>

            {/* Measurements */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 border-b pb-3">
                Measurements (meters)
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Set your preferred Width and Height in meters. Price updates based on the measurement.
              </p>

              <div className="space-y-4">
                {items.map((item) => {
                  const product = products[item.product_id];
                  const baseW = Number((product as any)?.width ?? 0);
                  const baseH = Number((product as any)?.height ?? 0);

                  const w = item.meta?.custom_dimensions?.width ?? (Number.isFinite(baseW) && baseW > 0 ? String(baseW) : "");
                  const h = item.meta?.custom_dimensions?.height ?? (Number.isFinite(baseH) && baseH > 0 ? String(baseH) : "");

                  return (
                    <div key={item.id} className="rounded-lg border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-semibold text-gray-900">{product?.name || "Product"}</div>
                          <div className="text-xs text-gray-500">Qty: {item.quantity || 1}</div>
                          {(Number.isFinite(baseW) && baseW > 0 && Number.isFinite(baseH) && baseH > 0) && (
                            <div className="text-xs text-gray-500 mt-1">Default: {baseW}m × {baseH}m</div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">Unit</div>
                          <div className="font-bold text-gray-900">₱{computeUnitPrice(item).toLocaleString()}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Width (m)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={w}
                            onChange={(e) => setItemMeasurementLocal(item.id, e.target.value, String(h ?? ""))}
                            onBlur={() => persistItemMeasurement(item.id)}
                            placeholder="e.g. 2.40"
                            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-[#8B1C1C] focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Height (m)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={h}
                            onChange={(e) => setItemMeasurementLocal(item.id, String(w ?? ""), e.target.value)}
                            onBlur={() => persistItemMeasurement(item.id)}
                            placeholder="e.g. 1.80"
                            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-[#8B1C1C] focus:border-transparent"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Payment Method */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 border-b pb-3">
                Payment Method
              </h2>
              <div className="mb-4">
                <div className="text-sm font-semibold text-gray-700">Billing Information</div>
                <div className="text-xs text-gray-500 mt-1">
                  Contact details (Name, Email, Phone) will be collected inside PayRex checkout.
                  Your delivery/pickup address stays from the address or branch selected on this page.
                </div>
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-4 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-[#8B1C1C] transition">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "payrex"}
                    onChange={() => setPaymentMethod("payrex")}
                    className="w-4 h-4 text-[#8B1C1C]"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">PayRex</div>
                    <div className="text-sm text-gray-500">GCash, Maya</div>
                    {payrexPhone ? (
                      <div className="text-xs text-[#8B1C1C] mt-1">Admin PayRex Phone: {payrexPhone}</div>
                    ) : null}
                  </div>
                </label>
                <label className="flex items-center gap-3 p-4 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-[#8B1C1C] transition">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "paypal"}
                    onChange={() => setPaymentMethod("paypal")}
                    className="w-4 h-4 text-[#8B1C1C]"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">PayPal</div>
                    <div className="text-sm text-gray-500">Pay with PayPal account</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Apply Voucher */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 border-b pb-3">
                Discount Code
              </h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value)}
                  placeholder="Enter voucher code"
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-[#8B1C1C] focus:border-transparent"
                />
                <button
                  onClick={applyVoucher}
                  disabled={applyingVoucher || !voucherCode.trim()}
                  className="px-6 py-3 bg-[#8B1C1C] text-white rounded-lg font-semibold hover:bg-[#7a1919] disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {applyingVoucher ? "Applying..." : "Apply"}
                </button>
              </div>
              {voucherInfo && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-medium">
                  ✓ Voucher "{voucherInfo.code}" applied ({voucherInfo.type === 'percent' ? `${voucherInfo.value}%` : `₱${voucherInfo.value.toLocaleString()}`} off)
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 border-b pb-3">
                Reservation Summary
              </h2>

              {/* Items List */}
              <div className="mb-4 space-y-3 max-h-64 overflow-y-auto">
                {items.map((item) => {
                  const product = products[item.product_id];
                  const image = (product?.images && product.images[0]) || product?.image1 || "/no-orders.png";
                  const qty = item.quantity || 1;
                  const unitPrice = computeUnitPrice(item);
                  const addons = Array.isArray(item.meta?.addons)
                    ? item.meta.addons.reduce((sum: number, addon: any) => sum + Number(addon?.fee || 0), 0)
                    : 0;
                  const lineTotal = (unitPrice + addons) * qty;

                  return (
                    <div key={item.id} className="flex gap-3 pb-3 border-b">
                      <img src={image} alt={product?.name || "Product"} className="w-16 h-16 object-cover rounded" />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 text-sm">{product?.name || "Product"}</div>
                        <div className="text-xs text-gray-500">Qty: {qty}</div>
                        <div className="text-sm font-semibold text-gray-900">₱{lineTotal.toLocaleString()}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Product Subtotal</span>
                  <span>₱{totals.subtotal.toLocaleString()}</span>
                </div>
                {totals.addons > 0 && (
                  <div className="flex justify-between text-sm text-gray-700">
                    <span>Color Customization</span>
                    <span>₱{totals.addons.toLocaleString()}</span>
                  </div>
                )}
                {voucherInfo && totals.discount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 font-semibold">
                    <span>Discount</span>
                    <span>-₱{totals.discount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Reservation Fee</span>
                  <span>₱{totals.reservationFee.toLocaleString()}</span>
                </div>
                <hr className="my-3" />
                <div className="flex justify-between text-lg font-bold text-gray-900">
                  <span>Total Amount</span>
                  <span className="text-[#8B1C1C]">₱{totals.total.toLocaleString()}</span>
                </div>
              </div>

              {/* Checkout Button */}
              <button
                onClick={handleCheckout}
                disabled={
                  submitting ||
                  items.length === 0 ||
                  (fulfillmentMethod === "delivery" ? !selectedAddressId : !selectedBranch)
                }
                className="w-full bg-gradient-to-r from-[#8B1C1C] to-[#a83232] text-white rounded-lg px-6 py-4 font-bold text-lg hover:from-[#7a1919] hover:to-[#8B1C1C] disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] shadow-lg"
              >
                {submitting ? "Processing..." : `Pay ₱${totals.total.toLocaleString()}`}
              </button>

              <p className="text-xs text-gray-500 text-center mt-4">
                By proceeding, you agree to our terms and conditions
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CartCheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B1C1C] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <CartCheckoutContent />
    </Suspense>
  );
}
