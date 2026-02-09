"use client";

import { Suspense, useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { FaCheckCircle, FaShoppingCart, FaArrowRight } from "react-icons/fa";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

type OrderItem = {
  id: string;
  product_id: string;
  quantity: number;
  price: number;
  total_amount: number;
  total_paid: number;
  meta: any;
  status: string;
  payment_status: string;
  payment_method?: string;
  created_at: string;
};

type Product = {
  id: string;
  name?: string;
  images?: string[];
  image1?: string;
};

function CartSuccessPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const source = searchParams.get("source");
  const ref = searchParams.get("ref");
  
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const loadOrderDetails = async () => {
      try {
        // Get current user
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) {
          router.push("/login");
          return;
        }

        const uid = userData.user.id;
        setUserId(uid);

        // First try: use receipt_ref to fetch only the items from this transaction
        let scopedItems: any[] = [];
        if (ref) {
          const { data: refItems, error: refErr } = await supabase
            .from("user_items")
            .select("*")
            .eq("user_id", uid)
            .eq("item_type", "reservation")
            .contains("meta", { receipt_ref: ref });
          if (refErr) throw refErr;
          scopedItems = refItems || [];
        }

        // Fallback: if no ref or nothing found (older sessions), limit by very recent from_cart items
        if ((!ref || scopedItems.length === 0)) {
          const { data: items, error: itemsError } = await supabase
            .from("user_items")
            .select("*")
            .eq("user_id", uid)
            .eq("item_type", "reservation")
            .in("status", ["pending_payment", "reserved"]) // keep narrow statuses
            .order("created_at", { ascending: false })
            .limit(15);
          if (itemsError) throw itemsError;

          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          scopedItems = (items || []).filter((item: any) => {
            const ts = item.updated_at || item.created_at;
            const fromCart = item.meta?.from_cart === true;
            return ts && ts > fiveMinutesAgo && (fromCart || source === 'cart');
          });
        }

        setOrderItems(scopedItems);

        // Load product details
        if (scopedItems.length > 0) {
          const productIds = Array.from(new Set(scopedItems.map((item: any) => item.product_id)));
          const { data: prodData } = await supabase
            .from("products")
            .select("id, name, images, image1")
            .in("id", productIds);

          const prodMap: Record<string, Product> = {};
          (prodData || []).forEach((p: any) => {
            prodMap[p.id] = p;
          });
          setProducts(prodMap);
  }
      } catch (error) {
        console.error("Error loading order details:", error);
      } finally {
        setLoading(false);
      }
    };

    loadOrderDetails();
  }, [router]);

  // Fallback cleanup to ensure any cart rows tied to these reservations are removed
  useEffect(() => {
    const cleanup = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = (userData as any)?.user?.id;
        if (!uid) return;
        await fetch('/api/cart/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: uid, minutes: 180 })
        });
      } catch (e) {
        console.warn('cart cleanup skipped', e);
      }
    };
    if (!loading) cleanup();
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B1C1C] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading order details...</p>
        </div>
      </div>
    );
  }

  // Calculate totals
  const calculateTotals = () => {
    // Prefer server-computed totals to avoid double-counting (esp. reservation fee)
    let subtotal = 0;
    let addonsTotal = 0;
    let discount = 0;
    let reservationFee = 0;
    let grandTotal = 0;

    orderItems.forEach((item) => {
      const meta = item.meta || {};
      const qty = Number(item.quantity || 1);
      const unit = Number(meta.product_price ?? item.price ?? 0);
      const addonsPerUnit = Array.isArray(meta.addons)
        ? meta.addons.reduce((sum: number, a: any) => sum + Number(a?.fee || 0), 0)
        : 0;

      subtotal += unit * qty;
      addonsTotal += addonsPerUnit * qty;

      // Use server-provided per-line final total when available
      const finalPerLine = Number(
        item.total_amount ?? meta.final_total_per_item ?? 0
      );
      if (finalPerLine > 0) grandTotal += finalPerLine; else {
        const lineAfterDiscount = Number(meta.line_total_after_discount ?? (unit + addonsPerUnit) * qty);
        const share = Number(meta.reservation_fee_share ?? 0);
        grandTotal += Math.max(0, lineAfterDiscount + share);
      }

      if (discount === 0 && typeof meta.discount_value !== 'undefined') {
        discount = Number(meta.discount_value || 0);
      }
      if (reservationFee === 0 && (meta.reservation_fee || meta.reservation_fee_share)) {
        reservationFee = Number(meta.reservation_fee || 500);
      }
    });

    return { subtotal, addonsTotal, discount, reservationFee, total: grandTotal };
  };

  const totals = calculateTotals();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Success Header */}
          <div className="bg-gradient-to-r from-green-600 to-green-500 text-white px-6 py-10 text-center">
            <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
              <FaCheckCircle className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Order Confirmed!</h1>
            <p className="text-green-100 text-lg">Your reservation has been successfully processed</p>
          </div>

          <div className="p-8">
            {/* Order Summary */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <FaShoppingCart className="text-[#8B1C1C]" />
                Order Receipt
              </h2>
              
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Order Date:</span>
                    <div className="font-semibold text-gray-900">
                      {orderItems.length > 0 
                        ? new Date(orderItems[0].created_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : '-'}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">Payment Method:</span>
                    <div className="font-semibold text-gray-900 capitalize">
                      {orderItems.length > 0 && orderItems[0].payment_method 
                        ? orderItems[0].payment_method === 'paymongo' 
                          ? `PayMongo${orderItems[0].meta?.paymongo_channel ? ` (${String(orderItems[0].meta.paymongo_channel).toUpperCase()})` : ' (GCash/Maya/Card)'}` 
                          : 'PayPal'
                        : '-'}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">Payment Status:</span>
                    <div className="font-semibold text-green-600">
                      {orderItems.length > 0 && orderItems[0].payment_status === 'completed' 
                        ? 'Completed' 
                        : 'Pending'}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">Total Items:</span>
                    <div className="font-semibold text-gray-900">{orderItems.length} item(s)</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Items List */}
            <div className="mb-8">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Reserved Items</h3>
              <div className="space-y-4">
                {orderItems.map((item) => {
                  const product = products[item.product_id];
                  const image = (product?.images && product.images[0]) || product?.image1 || "/no-orders.png";
                  const qty = item.quantity || 1;
                  const unitPrice = Number(item.price || 0);
                  const addons = Array.isArray(item.meta?.addons) ? item.meta.addons : [];
                  const addonsPerUnit = addons.reduce((sum: number, addon: any) => sum + Number(addon?.fee || 0), 0);
                  const lineTotal = (unitPrice + addonsPerUnit) * qty;

                  return (
                    <div key={item.id} className="flex gap-4 p-4 border border-gray-200 rounded-lg hover:shadow-md transition">
                      <img 
                        src={image} 
                        alt={product?.name || "Product"} 
                        className="w-24 h-24 object-cover rounded-lg"
                      />
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 text-lg">{product?.name || "Product"}</h4>
                        <div className="text-sm text-gray-600 mt-1">
                          <div>Unit Price: ₱{unitPrice.toLocaleString()}</div>
                          <div>Quantity: {qty}</div>
                          {addons.length > 0 && (
                            <div className="mt-1">
                              <span className="font-medium">Add-ons:</span>
                              <ul className="ml-4 mt-1">
                                {addons.map((addon: any, idx: number) => (
                                  <li key={idx} className="text-xs">
                                    • {addon.label || addon.key} - ₱{Number(addon.fee || 0).toLocaleString()}
                                    {addon.value && ` (${addon.value})`}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        <div className="mt-2 text-lg font-bold text-[#8B1C1C]">
                          ₱{lineTotal.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Payment Breakdown */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Payment Summary</h3>
              <div className="bg-gray-50 rounded-lg p-6 space-y-3">
                <div className="flex justify-between text-gray-700">
                  <span>Product Subtotal</span>
                  <span className="font-semibold">₱{totals.subtotal.toLocaleString()}</span>
                </div>
                
                {totals.addonsTotal > 0 && (
                  <div className="flex justify-between text-gray-700">
                    <span>Color Customization</span>
                    <span className="font-semibold">₱{totals.addonsTotal.toLocaleString()}</span>
                  </div>
                )}
                
                {totals.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span className="font-semibold">-₱{totals.discount.toLocaleString()}</span>
                  </div>
                )}
                
                <div className="flex justify-between text-gray-700">
                  <span>Reservation Fee</span>
                  <span className="font-semibold">₱{totals.reservationFee.toLocaleString()}</span>
                </div>
                
                <div className="border-t border-gray-300 pt-3 mt-3">
                  <div className="flex justify-between text-xl font-bold text-gray-900">
                    <span>Total Paid</span>
                    <span className="text-[#8B1C1C]">₱{totals.total.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Additional Information */}
            <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-blue-900 mb-3">What's Next?</h3>
              <ul className="space-y-2 text-sm text-blue-800">
                <li className="flex items-start gap-2">
                  <FaCheckCircle className="text-blue-600 mt-0.5 flex-shrink-0" />
                  <span>Your order has been confirmed and is now in your reservations</span>
                </li>
                <li className="flex items-start gap-2">
                  <FaCheckCircle className="text-blue-600 mt-0.5 flex-shrink-0" />
                  <span>You'll receive updates on your order status via email</span>
                </li>
                <li className="flex items-start gap-2">
                  <FaCheckCircle className="text-blue-600 mt-0.5 flex-shrink-0" />
                  <span>Track your order anytime from your profile reservations page</span>
                </li>
                <li className="flex items-start gap-2">
                  <FaCheckCircle className="text-blue-600 mt-0.5 flex-shrink-0" />
                  <span>Our team will contact you regarding delivery arrangements</span>
                </li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Link 
                href="/profile/reserve"
                className="flex-1 bg-gradient-to-r from-[#8B1C1C] to-[#a83232] text-white rounded-lg px-6 py-4 font-bold text-center hover:from-[#7a1919] hover:to-[#8B1C1C] transition-all transform hover:scale-[1.02] shadow-lg flex items-center justify-center gap-2"
              >
                View My Reservations
                <FaArrowRight />
              </Link>
              <Link 
                href="/Product"
                className="flex-1 bg-white border-2 border-[#8B1C1C] text-[#8B1C1C] rounded-lg px-6 py-4 font-bold text-center hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
              >
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CartSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B1C1C] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <CartSuccessPageContent />
    </Suspense>
  );
}
