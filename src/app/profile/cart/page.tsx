"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { computeMeasurementPricing } from "@/utils/measurementPricing";
import { PICKUP_ADDRESS, type FulfillmentMethod } from "@/utils/fulfillment";

type UserItem = {
  price: number | undefined;
  id: string;
  product_id: string;
  quantity: number;
  meta: any;
};

type Product = {
  id: string;
  name?: string;
  price?: number;
  images?: string[];
  image1?: string;
  width?: number;
  height?: number;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DELIVERY_FEE = 2599;

type Address = {
  id: string;
  full_name?: string;
  phone?: string;
  address?: string;
  is_default: boolean;
};

const measurementsMatch = (left?: number, right?: number) => {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) < 0.000001;
};

export default function CartPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<UserItem[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>("delivery");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [voucher, setVoucher] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<{ code: string; type: 'percent'|'amount'; value: number } | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data?.user?.id || null;
      setUserId(uid);
      if (!uid) return setLoading(false);
      loadCart(uid);
    });
  }, []);

    const loadCart = async (uid: string) => {
    try {
      // Query the cart table instead of user_items
      const { data: cartData, error: cartError } = await supabase
        .from("cart")
        .select("id, product_id, quantity, meta")
        .eq("user_id", uid);

      if (cartError) throw cartError;
      setItems(cartData as any || []);

      const productIds = Array.from(new Set(cartData?.map((item: any) => item.product_id) || []));
      if (productIds.length > 0) {
        const { data: prodData } = await supabase
          .from("products")
          .select("id, name, price, images, image1, width, height")
          .in("id", productIds);

        const map: Record<string, Product> = {};
        (prodData || []).forEach((p: any) => {
          map[p.id] = p;
        });
        setProducts(map);
      }
    } catch (error) {
      console.error("Error loading cart:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = (value: boolean) => {
    if (!value) return setSelected({});
    const next: Record<string, boolean> = {};
    items.forEach(item => (next[item.id] = true));
    setSelected(next);
  };

  const selectedItems = useMemo(
    () => items.filter(item => selected[item.id]),
    [items, selected]
  );

  const computeUnitPrice = useCallback((item: UserItem) => {
    const product = products[item.product_id];
    const storedUnitPrice = Number(item.meta?.pricing?.unit_price ?? item.meta?.product_price);
    const storedUnitPriceValid = Number.isFinite(storedUnitPrice) && storedUnitPrice > 0;
    const defaultUnitPrice = Math.max(0, Number(product?.price ?? 0));
    const unitPricePerSqm = defaultUnitPrice;
    const baseWidthRaw = Number(product?.width ?? 0);
    const baseHeightRaw = Number(product?.height ?? 0);
    const baseWidthM = Number.isFinite(baseWidthRaw) && baseWidthRaw > 0 ? baseWidthRaw / 1000 : undefined;
    const baseHeightM = Number.isFinite(baseHeightRaw) && baseHeightRaw > 0 ? baseHeightRaw / 1000 : undefined;
    const explicitEnabled = item.meta?.custom_dimensions?.enabled;
    const customWidth = item.meta?.custom_dimensions?.width;
    const customHeight = item.meta?.custom_dimensions?.height;
    const customDiffersFromBase =
      !measurementsMatch(Number(customWidth), baseWidthM) ||
      !measurementsMatch(Number(customHeight), baseHeightM);

    // Custom pricing applies only when there is an actual size difference from the base measurement.
    const useCustomMeasurements = explicitEnabled !== false && customDiffersFromBase;

    // If the user didn't change the base measurement, keep the original/stored unit price stable.
    if (!useCustomMeasurements && storedUnitPriceValid) {
      return storedUnitPrice;
    }

    if (!useCustomMeasurements) {
      return defaultUnitPrice;
    }

    return computeMeasurementPricing({
      widthMeters: useCustomMeasurements ? customWidth ?? baseWidthM : baseWidthM,
      heightMeters: useCustomMeasurements ? customHeight ?? baseHeightM : baseHeightM,
      unitPricePerSqm,
      minSqm: 0,
      sqmDecimals: 2,
    }).unit_price;
  }, [products]);

  const totals = useMemo(() => {
    const base = selectedItems.reduce(
      (acc, item) => {
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
    const deliveryFee =
      selectedItems.length > 0 && fulfillmentMethod === "delivery" ? DELIVERY_FEE : 0;
    const total = Math.max(0, preDiscount - discount + deliveryFee);
    return { ...base, discount, deliveryFee, total };
  }, [selectedItems, voucherInfo, fulfillmentMethod, computeUnitPrice]);

  const updateQuantity = async (item: UserItem, delta: number) => {
    const next = Math.max(1, (item.quantity || 1) + delta);
    await fetch("/api/cart", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, quantity: next })
    });
    if (userId) loadCart(userId);
  };

  const removeItem = async (id: string) => {
    await fetch(`/api/cart?id=${id}`, { method: "DELETE" });
    if (userId) loadCart(userId);
  };

  const clearCart = async () => {
    if (!userId) return;
    await fetch(`/api/cart?clear=true&userId=${userId}`, { method: "DELETE" });
    loadCart(userId);
  };

  const proceedCheckout = () => {
    if (!userId) {
      alert("Sign in required.");
      return;
    }
    if (!selectedItems.length) {
      alert("Select at least one item.");
      return;
    }
    
    // Navigate to checkout page with selected items
    const itemIds = selectedItems.map(item => item.id).join(",");
    router.push(`/profile/cart/checkout?items=${itemIds}&delivery_method=${fulfillmentMethod}`);
  };

  const applyVoucher = async () => {
    if (!selectedItems.length) return alert("Select items first.");
    setApplying(true);
    try {
      const preDiscount = totals.subtotal + totals.addons;
      const res = await fetch("/api/discount-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: voucher.trim(), subtotal: preDiscount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Invalid code");
      setVoucherInfo(data.discount);
    } catch (error: any) {
      alert(error.message);
      setVoucherInfo(null);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-black">Loading cart…</div>;
  }

  if (!userId) {
    return (
      <div className="p-8 text-center text-black">
        Please <Link href="/login" className="text-[#8B1C1C] underline">sign in</Link> to view your cart.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex gap-6">
        {/* Left side - Cart Items */}
        <div className="flex-1 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedItems.length === items.length && items.length > 0}
                onChange={event => toggleAll(event.target.checked)}
              />
              <span className="text-black">
                Select All ({selectedItems.length}/{items.length})
              </span>
            </div>
            <button onClick={clearCart} className="text-red-600 hover:underline">
              Clear Cart
            </button>
          </div>

          <div className="space-y-4">
        {items.map(item => {
          const product = products[item.product_id];
          const image =
            (product?.images && product.images[0]) ||
            product?.image1 ||
            "/no-orders.png";

          const selectedFlag = !!selected[item.id];
          const qty = item.quantity || 1;
          const unitPrice = computeUnitPrice(item);
          const addonsArr: any[] = Array.isArray(item.meta?.addons) ? item.meta.addons : [];
          const hasColorAddon = addonsArr.some((a: any) => a?.key === 'color_customization');
          const colorValue = (addonsArr.find((a: any) => a?.key === 'color_customization')?.value) || '';
          const addonsFee = addonsArr.reduce((sum: number, addon: any) => sum + Number(addon?.fee || 0), 0);
          const unitWithAddons = unitPrice + addonsFee;
          const lineTotal = unitWithAddons * qty;

          const updateItemMeta = async (nextAddons: any[]) => {
            await fetch("/api/cart", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: item.id, meta: { ...(item.meta || {}), addons: nextAddons } })
            });
            if (userId) loadCart(userId);
          };

          const toggleAddon = async (checked: boolean) => {
            const next = [...addonsArr];
            const idx = next.findIndex((a: any) => a?.key === 'color_customization');
            if (checked) {
              if (idx === -1) {
                // Do not pre-fill any text; leave value empty until the user types
                next.push({ key: 'color_customization', label: 'Color Customization', fee: 2500, value: colorValue || '' });
              }
            } else {
              if (idx !== -1) next.splice(idx, 1);
            }
            await updateItemMeta(next);
          };

          const updateColorValue = async (val: string) => {
            const next = [...addonsArr];
            const idx = next.findIndex((a: any) => a?.key === 'color_customization');
            if (idx !== -1) {
              // Keep empty string if user clears the field
              next[idx] = { ...next[idx], value: val || '' };
              await updateItemMeta(next);
            }
          };

          return (
            <div key={item.id} className="bg-white border rounded-lg p-4">
              <div className="flex gap-4">
                <input
                  type="checkbox"
                  checked={selectedFlag}
                  onChange={(e) => setSelected(prev => ({ ...prev, [item.id]: e.target.checked }))}
                  className="mt-2"
                />
                <div className="w-24 h-24 shrink-0 rounded border border-gray-200 bg-gray-100 overflow-hidden">
                  <img
                    src={image}
                    alt={product?.name || 'Item'}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between">
                    <div>
                      <div className="text-black font-semibold">{product?.name || 'Product'}</div>
                      <div className="text-black text-sm">₱{unitPrice.toLocaleString()} each{addonsFee > 0 && ` + ₱${addonsFee.toLocaleString()} addons = ₱${unitWithAddons.toLocaleString()}/unit`}</div>
                      <div className="text-black text-base font-semibold mt-1">Line Total: ₱{lineTotal.toLocaleString()}</div>
                    </div>
                    <button onClick={() => removeItem(item.id)} className="text-red-600 text-sm hover:underline">Remove</button>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button className="px-2 py-1 border rounded text-black" onClick={() => updateQuantity(item, -1)}>-</button>
                    <span className="w-10 text-center text-black">{qty}</span>
                    <button className="px-2 py-1 border rounded text-black" onClick={() => updateQuantity(item, 1)}>+</button>
                  </div>

                  <div className="mt-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={hasColorAddon}
                        onChange={e => toggleAddon(e.target.checked)}
                      />
                      <span className="text-sm text-black">Color Customization (+₱2,500 per unit)</span>
                    </label>
                    {hasColorAddon && (
                      <input
                        className="mt-2 border rounded px-3 py-2 w-full text-black"
                        placeholder="Enter desired color"
                        defaultValue={colorValue}
                        onBlur={e => updateColorValue(e.target.value)}
                      />
                    )}
                  </div>

                  <div className="mt-3 text-sm text-black">
                    {addonsArr.length > 0 && (
                      <div>
                        Add-ons:
                        <ul className="list-disc ml-5">
                          {addonsArr.map((a: any, i: number) => (
                            <li key={i}>{a.label || a.key} - ₱{Number(a.fee || 0).toLocaleString()} {a.value ? `(${a.value})` : ''}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="p-8 text-center text-black border rounded bg-white">Your cart is empty.</div>
        )}
      </div>
        </div>

        {/* Right side - Sticky Payment Details */}
        <div className="w-96">
          <div className="sticky top-6 bg-white border rounded-lg shadow-lg p-6 space-y-4">
            <div className="text-black font-bold text-xl border-b pb-3">Payment Summary</div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-black">Delivery Option</div>
              <div className="flex flex-wrap gap-6 text-sm text-black">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="fulfillmentMethod"
                    checked={fulfillmentMethod === "delivery"}
                    onChange={() => setFulfillmentMethod("delivery")}
                  />
                  Delivery
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="fulfillmentMethod"
                    checked={fulfillmentMethod === "pickup"}
                    onChange={() => setFulfillmentMethod("pickup")}
                  />
                  Pickup
                </label>
              </div>
              {fulfillmentMethod === "pickup" ? (
                <div className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3">
                  <div className="text-sm font-semibold text-gray-700">Pickup Address</div>
                  <div className="mt-1 text-sm text-gray-800">{PICKUP_ADDRESS}</div>
                </div>
              ) : null}
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between text-sm text-black">
                <span>Product Subtotal</span>
                <span>₱{totals.subtotal.toLocaleString()}</span>
              </div>
              
              <div className="flex justify-between text-sm text-black">
                <span>Color Customization</span>
                <span>₱{totals.addons.toLocaleString()}</span>
              </div>
              
              {voucherInfo && (
                <div className="flex justify-between text-sm text-green-700 font-semibold">
                  <span>Discount ({voucherInfo.code})</span>
                  <span>-₱{Number(totals.discount || 0).toLocaleString()}</span>
                </div>
              )}
              
              {fulfillmentMethod === "delivery" ? (
                <div className="flex justify-between text-sm text-black">
                  <span>Delivery Fee</span>
                  <span>₱{totals.deliveryFee.toLocaleString()}</span>
                </div>
              ) : null}
              
              <hr className="my-3 border-gray-300" />
              
              <div className="flex justify-between text-lg text-black font-bold">
                <span>Total Amount</span>
                <span className="text-[#8B1C1C]">₱{totals.total.toLocaleString()}</span>
              </div>
            </div>

            <button
              onClick={proceedCheckout}
              disabled={processing || !selectedItems.length}
              className="w-full mt-4 bg-gradient-to-r from-[#8B1C1C] to-[#a83232] text-white rounded-lg px-4 py-3 font-semibold disabled:opacity-50 hover:from-[#7a1919] hover:to-[#8B1C1C] transition-all transform hover:scale-[1.02] shadow-lg"
            >
              {processing ? 'Processing…' : 'Pay Now'}
            </button>

            <div className="mt-6 pt-4 border-t">
              <div className="text-black font-semibold mb-3 text-sm">Apply Voucher Code</div>
              <div className="flex items-center gap-2">
                <input
                  value={voucher}
                  onChange={event => setVoucher(event.target.value)}
                  placeholder="Enter voucher code"
                  className="flex-1 border rounded-lg px-3 py-2 text-black text-sm focus:ring-2 focus:ring-[#8B1C1C] outline-none"
                />
                <button
                  onClick={applyVoucher}
                  disabled={applying || !selectedItems.length}
                  className="px-4 py-2 bg-[#8B1C1C] text-white rounded-lg disabled:opacity-50 hover:bg-[#7a1919] transition text-sm font-semibold"
                >
                  {applying ? 'Applying…' : 'Apply'}
                </button>
              </div>
              {voucherInfo && (
                <div className="mt-2 text-sm text-green-700 font-medium">
                  ✓ Applied {voucherInfo.code} ({voucherInfo.type === 'percent' ? `${voucherInfo.value}%` : `₱${voucherInfo.value.toLocaleString()}`} off)
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}