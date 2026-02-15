"use client";

import { Suspense, useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

function ReservationSuccessPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reservationId = searchParams.get("reservation_id");
  
  const [reservation, setReservation] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadReservation = async () => {
      if (!reservationId) {
        router.push("/");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("user_items")
          .select("*")
          .eq("id", reservationId)
          .eq("item_type", "reservation")
          .single();

        if (error) throw error;
        setReservation(data);
      } catch (error) {
        console.error("Error loading reservation:", error);
        alert("Error loading reservation details");
        router.push("/");
      } finally {
        setLoading(false);
      }
    };

    loadReservation();
  }, [reservationId, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B1C1C]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Success Header */}
          <div className="bg-green-600 text-white px-6 py-8 text-center">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2 text-black">Reservation Successful!</h1>
            <p className="text-green-100">Your product has been reserved successfully</p>
          </div>

          <div className="p-6">
            {/* Reservation Details */}
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-4 text-gray-800">Reservation Receipt</h2>

              {(() => {
                const qty = Number(reservation?.quantity || 1);
                const price = Number(reservation?.meta?.product_price || 0);
                const addons: any[] = Array.isArray(reservation?.meta?.addons) ? reservation.meta.addons : [];
                const addonsTotal = Number(reservation?.meta?.addons_total ?? (addons.reduce((s, a) => s + Number(a?.fee || 0), 0) * qty));
                const discountValue =
                  Number(reservation?.meta?.discount_value ?? reservation?.meta?.voucher_discount ?? 0);
                const subtotal = Number(reservation?.meta?.subtotal ?? price * qty);
                const total = Number(reservation?.meta?.total_amount ?? Math.max(0, subtotal + addonsTotal - discountValue));
                const reservationFee = Number(reservation?.meta?.reservation_fee ?? 500);
                const stockBefore = reservation?.meta?.product_stock_before ?? reservation?.meta?.product_inventory;
                const stockAfter = reservation?.meta?.product_stock_after;
                const dims = reservation?.meta?.custom_dimensions;
                const branch = reservation?.meta?.selected_branch || '-';
                const voucherCode = reservation?.meta?.voucher_code || null;
                const billingEmail =
                  reservation?.meta?.billing_email ||
                  reservation?.meta?.customer_email ||
                  reservation?.customer_email ||
                  null;
                const billingPhone =
                  reservation?.meta?.billing_phone ||
                  reservation?.meta?.customer_phone ||
                  reservation?.customer_phone ||
                  null;

                const formatMeters = (v: any) => {
                  const n = Number(v);
                  if (!Number.isFinite(n) || n <= 0) return "-";
                  // Back-compat: older data may be in mm.
                  const meters = n > 50 ? n / 1000 : n;
                  return meters.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
                };

                return (
                  <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Reservation ID:</span>
                      <span className="font-mono text-black">{reservation?.id}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Product:</span>
                      <span className="font-medium text-black">{reservation?.meta?.product_name || '-'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Quantity:</span>
                      <span className="text-black">{qty}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Branch:</span>
                      <span className="text-black">{branch}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Dimensions:</span>
                      <span className="text-black">
                        {dims
                          ? `${formatMeters(dims.width)}m x ${formatMeters(dims.height)}m`
                          : '—'}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Product Subtotal:</span>
                      <span className="text-black">₱{subtotal.toLocaleString()}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Add-ons:</span>
                      <span className="text-black">₱{addonsTotal.toLocaleString()}</span>
                    </div>

                    {voucherCode && (
                      <div className="flex justify-between text-sm">
                        <span className="text-black font-medium">Discount ({voucherCode}):</span>
                        <span className="text-green-700">-₱{Number(discountValue).toLocaleString()}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-sm font-semibold">
                      <span className="text-black">Total:</span>
                      <span className="text-black">₱{Number(total).toLocaleString()}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Reservation Fee (Paid Now):</span>
                      <span className="text-black">₱{reservationFee.toLocaleString()}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-black font-medium">Balance Due:</span>
                      <span className="text-black">₱{Math.max(0, Number(total) - reservationFee).toLocaleString()}</span>
                    </div>

                    {(billingEmail || billingPhone) && (
                      <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                        <div className="font-semibold">Invoice Destination</div>
                        {billingEmail && <div>Email: {billingEmail}</div>}
                        {billingPhone && <div>Phone: {billingPhone}</div>}
                      </div>
                    )}

                    {typeof stockBefore !== 'undefined' && (
                      <div className="flex justify-between text-xs text-black pt-2">
                        <span className="font-medium">Stock Before:</span>
                        <span>{String(stockBefore)}</span>
                      </div>
                    )}
                    {typeof stockAfter !== 'undefined' && (
                      <div className="flex justify-between text-xs text-black">
                        <span className="font-medium">Stock After:</span>
                        <span>{String(stockAfter)}</span>
                      </div>
                    )}

                    {Array.isArray(addons) && addons.length > 0 && (
                      <div className="text-xs text-black pt-2">
                        <span className="font-medium">Add-ons:</span>
                        <ul className="list-disc ml-5">
                          {addons.map((a, i) => (
                            <li key={i}>{a.label || a.key}: ₱{Number(a.fee || 0).toLocaleString()} {a.value ? `(${a.value})` : ''}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Next Steps */}
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3 text-gray-800">What's Next?</h2>
              <div className="space-y-3 text-sm text-gray-600">
                <div className="flex items-start">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold mr-3 mt-0.5">1</div>
                  <div>
                    <p className="font-medium text-gray-800">Waiting for Admin Approval</p>
                    <p>Your reservation is currently being reviewed by our admin team.</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-6 h-6 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-xs font-bold mr-3 mt-0.5">2</div>
                  <div>
                    <p className="font-medium text-gray-800">Order Confirmation</p>
                    <p>Once approved, your reservation will move to the orders section where you can see the full receipt and invoice.</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-6 h-6 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-xs font-bold mr-3 mt-0.5">3</div>
                  <div>
                    <p className="font-medium text-gray-800">Production & Delivery</p>
                    <p>Your product will be prepared and delivered to your specified address.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Link 
                href="/profile/reserve"
                className="flex-1 bg-[#8B1C1C] text-white py-3 px-6 rounded-lg font-semibold text-center hover:bg-red-800 transition-colors"
              >
                View My Reservations
              </Link>
              
              <Link 
                href="/Product"
                className="flex-1 bg-gray-500 text-white py-3 px-6 rounded-lg font-semibold text-center hover:bg-gray-600 transition-colors"
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

export default function ReservationSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading reservation details...</div>}>
      <ReservationSuccessPageContent />
    </Suspense>
  );
}