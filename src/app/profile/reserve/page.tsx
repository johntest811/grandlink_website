"use client";

import { useState, useEffect, useMemo, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import Image from "next/image";
import { getMetaFulfillmentMethod, PICKUP_ADDRESS } from "@/utils/fulfillment";

type UserItem = {
  id: string;
  user_id: string;
  product_id: string;
  item_type: string;
  status: string;
  order_status?: string;
  quantity: number;
  meta: any;
  created_at: string;
  updated_at?: string;
  payment_status?: string;
  payment_id?: string;
  delivery_address_id?: string;
  special_instructions?: string;
  admin_notes?: string;
  estimated_delivery_date?: string;
  total_paid?: number;
  total_amount?: number;
  payment_method?: string;
};

type Product = {
  id: string;
  name?: string;
  price?: number;
  images?: string[];
  image1?: string;
  image2?: string;
  stock_quantity?: number;
  inventory?: number;
  length?: number;
  width?: number;
  height?: number;
  material?: string;
  type?: string;
};

type Address = {
  id: string;
  user_id: string;
  full_name?: string;
  phone?: string;
  address?: string;
  label?: string;
  full_address?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  is_default: boolean;
};

// Single Supabase client instance
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function ProfileReservePageContent() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UserItem[]>([]);
  const [productsById, setProductsById] = useState<Record<string, Product>>({});
  const [addressesById, setAddressesById] = useState<Record<string, Address>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showFullReceipt, setShowFullReceipt] = useState<{item: UserItem, product: Product} | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        // Get current user
        const { data: userData } = await supabase.auth.getUser();
        const currentUserId = userData?.user?.id;
        
        if (!currentUserId) {
          console.log("No user found");
          setLoading(false);
          return;
        }

        setUserId(currentUserId);

        // Fetch user's reservations
        const { data: userItems, error: itemsError } = await supabase
          .from("user_items")
          .select("*")
          .eq("user_id", currentUserId)
          .eq("item_type", "reservation")
          .in("status", ["pending_payment","reserved","pending_balance_payment","pending_cancellation"]) // keep in reserve only
          .order("created_at", { ascending: false });

        if (itemsError) {
          console.error("Error fetching reservations:", itemsError);
          return;
        }

        setItems(userItems || []);

        // Get unique product IDs and address IDs
        const productIds = [...new Set(userItems?.map(item => item.product_id) || [])];
        const addressIds = [...new Set(userItems?.map(item => item.delivery_address_id).filter(Boolean) || [])];

        // Fetch products
        if (productIds.length > 0) {
          const { data: products, error: productsError } = await supabase
            .from("products")
            .select("*")
            .in("id", productIds);

          if (!productsError && products) {
            const productsMap: Record<string, Product> = {};
            products.forEach(p => {
              productsMap[p.id] = p;
            });
            setProductsById(productsMap);
          }
        }

        // Fetch addresses
        if (addressIds.length > 0) {
          const { data: addresses, error: addressesError } = await supabase
            .from("addresses")
            .select("*")
            .in("id", addressIds);

          if (!addressesError && addresses) {
            const addressesMap: Record<string, Address> = {};
            addresses.forEach(a => {
              addressesMap[a.id] = a;
            });
            setAddressesById(addressesMap);
          }
        }

      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [searchParams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    
    return items.filter((item) => {
      const product = productsById[item.product_id];
      const productName = product?.name?.toLowerCase() || "";
      const itemId = item.id.toLowerCase();
      const status = item.status.toLowerCase();
      
      return productName.includes(q) || itemId.includes(q) || status.includes(q);
    });
  }, [items, productsById, query]);

  const requestCancellation = async (item: UserItem) => {
    if (!userId) return;

    const reason = window.prompt("Reason for cancellation (optional):", "") ?? "";
    if (!confirm("Request cancellation for this reservation?")) {
      return;
    }

    setActionLoading(item.id);
    try {
      const updatedMeta = {
        ...item.meta,
        cancel_requested: true,
        cancel_requested_at: new Date().toISOString(),
        cancel_reason: reason.trim() || null,
        cancel_prev_stage: String(item.status || "reservation"),
        cancellation_status: "pending_approval",
      };

      const { error } = await supabase
        .from("user_items")
        .update({ 
          status: "pending_cancellation",
          order_status: "pending_cancellation",
          meta: updatedMeta,
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);

      if (error) throw error;

      // Update local state
      setItems(prev => prev.map(i => 
        i.id === item.id 
          ? { ...i, status: "pending_cancellation", order_status: "pending_cancellation", meta: updatedMeta }
          : i
      ));

      alert("Cancellation request submitted successfully. You will be notified once reviewed by admin.");
    } catch (error: any) {
      console.error("Error requesting cancellation:", error);
      alert("Error submitting cancellation request: " + (error.message || "Unknown error"));
    } finally {
      setActionLoading(null);
    }
  };

  const viewFullReceipt = (item: UserItem) => {
    const product = productsById[item.product_id];
    if (product) {
      setShowFullReceipt({ item, product });
    }
  };

  const handleDownloadPDF = () => {
    if (!showFullReceipt) return;

    const item = showFullReceipt.item;
    const product = showFullReceipt.product;
    const unitPrice = Number(item.meta?.product_price ?? product?.price ?? 0);
    const totalAmount = Number(getItemTotalPrice(item, product) || 0);
    const reservationFee = Number(item.meta?.reservation_fee ?? 0);
    const fulfillmentMethod = getMetaFulfillmentMethod(item.meta);
    const pickupAddress = String(item.meta?.pickup_address || PICKUP_ADDRESS);
    const addonsTotal = Number(item.meta?.addons_total ?? 0);
    const discountValue = Number(item.meta?.discount_value ?? 0);
    const createdAt = new Date(item.created_at).toLocaleString();

    const popup = window.open("", "_blank", "width=900,height=900");
    if (!popup) {
      alert("Please allow pop-ups to export your receipt as PDF.");
      return;
    }

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Reservation Receipt</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
    .title { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .muted { color: #4b5563; font-size: 12px; }
    .label { color: #4b5563; font-size: 12px; margin-bottom: 4px; }
    .value { font-size: 14px; }
    .summary { background: #f9fafb; border-radius: 10px; padding: 12px; margin-top: 12px; }
    .row { display: flex; justify-content: space-between; font-size: 13px; margin: 6px 0; }
    .total { font-weight: 700; font-size: 18px; border-top: 1px solid #d1d5db; padding-top: 8px; margin-top: 8px; }
    @media print { body { margin: 10mm; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">
      <h1 style="margin:0;">GRAND EAST</h1>
      <div class="muted">Reservation Receipt</div>
    </div>

    <div class="grid">
      <div><div class="label">Order ID</div><div class="value">${item.id}</div></div>
      <div><div class="label">Date Created</div><div class="value">${createdAt}</div></div>
      <div><div class="label">Product</div><div class="value">${product?.name || "Unknown Product"}</div></div>
      <div><div class="label">Quantity</div><div class="value">${item.quantity} unit(s)</div></div>
    </div>

    <div class="summary">
      <div class="row"><span>Unit Price</span><span>₱${unitPrice.toLocaleString()}</span></div>
      ${
        fulfillmentMethod === "pickup"
          ? `<div class="row"><span>Pickup Address</span><span style="max-width:60%; text-align:right;">${pickupAddress}</span></div>`
          : reservationFee > 0
            ? `<div class="row"><span>Delivery Fee</span><span>₱${reservationFee.toLocaleString()}</span></div>`
            : ""
      }
      <div class="row"><span>Add-ons</span><span>₱${addonsTotal.toLocaleString()}</span></div>
      <div class="row"><span>Discount</span><span>-₱${discountValue.toLocaleString()}</span></div>
      <div class="row total"><span>Total Amount</span><span>₱${totalAmount.toLocaleString()}</span></div>
    </div>
  </div>

  <script>
    window.onload = function () {
      window.print();
      setTimeout(function () { window.close(); }, 300);
    };
  </script>
</body>
</html>`;

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  };

  // Colors -> black
  const getStatusColor = (status: string) => 'bg-black text-white';

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'pending_payment': return 'Pending Payment';
      case 'reserved': return 'Reserved';
      case 'approved': return 'Approved';
      case 'in_production': return 'In Production';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      case 'pending_cancellation': return 'Cancellation Pending';
      default: return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  const getProductImage = (product: Product) => {
    if (product.images && product.images.length > 0) {
      return product.images[0];
    }
    return product.image1 || product.image2 || "/no-image.png";
  };

  // Helper to safely get unit price or total amount
  const getItemTotalPrice = (it: UserItem, prod?: Product) => {
    // Prefer server-computed totals to match gateway amounts exactly
    const meta = it.meta || {};
    if (typeof meta.final_total_per_item === 'number' && meta.final_total_per_item > 0) {
      return Number(meta.final_total_per_item);
    }
    if (typeof it.total_amount === 'number' && it.total_amount > 0) {
      return Number(it.total_amount);
    }
    if (typeof it.total_paid === 'number' && it.total_paid > 0) {
      return Number(it.total_paid);
    }
    // Compute a best-effort fallback from meta if present
    const qty = Number(it.quantity || 1);
    const unit = Number(meta.product_price ?? prod?.price ?? 0);
    const addonsPerUnit = Array.isArray(meta.addons) ? meta.addons.reduce((s: number, a: any) => s + Number(a?.fee || 0), 0) : 0;
    const lineAfterDiscount = Number(meta.line_total_after_discount ?? (unit + addonsPerUnit) * qty);
    const share = Number(meta.reservation_fee_share ?? 0);
    return Math.max(0, lineAfterDiscount + share);
  };

  if (loading) {
    return (
      <section className="flex-1 flex flex-col px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading reservations...</div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex-1 flex flex-col px-8 py-8">
      <div className="mb-2">
        <input
          type="text"
          placeholder="Search reservations by product name, ID, or status"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border rounded px-4 py-2 bg-gray-100 text-gray-700"
        />
      </div>
      <hr className="mb-4" />

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center border rounded bg-white">
          <div className="flex flex-col items-center py-16">
            {/* <Image src="/no-orders.png" alt="No Reservations" width={80} height={80} /> */}
            <p className="mt-4 text-gray-600 text-lg font-medium">
              {query ? "No reservations match your search" : "No reservations yet"}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => {
            const product = productsById[item.product_id];
            const address = addressesById[item.delivery_address_id || ""];
            
            return (
              <div key={item.id} className="bg-white border rounded-lg p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  {/* Product Image */}
                  <div className="w-24 h-24 bg-gray-100 rounded flex-shrink-0">
                    {product && (
                      <Image
                        src={getProductImage(product)}
                        alt={product.name || "Product"}
                        width={96}
                        height={96}
                        className="w-full h-full object-cover rounded"
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-semibold text-lg text-black">
                          {product?.name || "Unknown Product"}
                        </h3>
                        <p className="text-gray-600 text-sm">
                          Order ID: {item.id.slice(0, 8)}...
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(item.status)}`}>
                        {getStatusDisplay(item.status)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mb-4">
                      <div>
                        <span className="font-medium">Quantity:</span> {item.quantity}
                      </div>
                      <div>
                        {/* Total Price */}
                        <span className="font-medium">Total Price:</span> ₱{getItemTotalPrice(item, product).toLocaleString()}
                      </div>
                      <div>
                        <span className="font-medium">Created:</span> {new Date(item.created_at).toLocaleDateString()}
                      </div>
                      {item.payment_status && (
                        <div>
                          <span className="font-medium">Payment:</span> {item.payment_status.replace(/_/g, ' ')}
                        </div>
                      )}
                      {item.payment_method && (
                        <div>
                          <span className="font-medium">Method:</span> {item.payment_method.toUpperCase()}
                          {item.payment_method === 'paymongo' && item.meta?.paymongo_channel
                            ? ` (${String(item.meta.paymongo_channel).toUpperCase()})`
                            : ''}
                        </div>
                      )}
                      {address && (
                        <div>
                          <span className="font-medium">Delivery:</span> {address.full_name}
                        </div>
                      )}
                    </div>

                    {item.special_instructions && (
                      <div className="mb-4">
                        <span className="font-medium text-sm">Special Instructions:</span>
                        <p className="text-sm text-gray-600 mt-1">{item.special_instructions}</p>
                      </div>
                    )}

                    {item.admin_notes && (
                      <div className="mb-4 p-3 bg-blue-50 rounded">
                        <span className="font-medium text-sm text-blue-800">Admin Notes:</span>
                        <p className="text-sm text-blue-700 mt-1">{item.admin_notes}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => viewFullReceipt(item)}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        View Details
                      </button>

                      {(item.status === 'pending_payment' || item.status === 'reserved' || item.status === 'pending_balance_payment') && (
                        <button
                          onClick={() => requestCancellation(item)}
                          disabled={actionLoading === item.id}
                          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                        >
                          Request Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showFullReceipt && (
        <>
          <style jsx global>{`
            @media print {
              @page {
                size: A4;
                margin: 15mm;
              }
              
              body * {
                visibility: hidden;
              }
              
              #receipt-print-area,
              #receipt-print-area * {
                visibility: visible;
              }
              
              #receipt-print-area {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                page-break-after: avoid;
                page-break-inside: avoid;
              }
              
              .no-print {
                display: none !important;
              }
              
              /* Ensure content fits on one page */
              #receipt-print-area {
                max-height: 267mm; /* A4 height minus margins */
                overflow: hidden;
              }
              
              /* Reduce spacing for print */
              #receipt-print-area .mb-8 {
                margin-bottom: 1rem !important;
              }
              
              #receipt-print-area .mb-6 {
                margin-bottom: 0.75rem !important;
              }
              
              #receipt-print-area .p-8 {
                padding: 1rem !important;
              }
              
              #receipt-print-area .p-4 {
                padding: 0.5rem !important;
              }
              
              /* Optimize font sizes for print */
              #receipt-print-area {
                font-size: 10pt;
              }
              
              #receipt-print-area h1 {
                font-size: 20pt;
              }
              
              #receipt-print-area h3 {
                font-size: 12pt;
              }
            }
          `}</style>
          
          <div className="fixed inset-0 bg-transparent flex items-center justify-center z-50 p-4">
            <div className="bg-white bg-opacity-95 backdrop-blur-sm rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
              {/* Action Buttons - Hidden in print */}
              <div className="no-print flex justify-between items-center p-4 border-b bg-white bg-opacity-80">
                <h2 className="text-lg font-semibold text-gray-800">Reservation Receipt</h2>
                <div className="flex gap-2">
                  <button
                    onClick={handleDownloadPDF}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    PDF
                  </button>
                  <button
                    onClick={() => setShowFullReceipt(null)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                  >
                    ✕ Close
                  </button>
                </div>
              </div>

              {/* Receipt Content */}
              <div 
                id="receipt-print-area" 
                ref={receiptRef}
                className="p-8 bg-white bg-opacity-90"
                style={{ maxWidth: '210mm', margin: '0 auto' }}
              >
                {/* Header */}
                <div className="text-center mb-8 border-b-2 border-gray-300 pb-6">
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">GRAND EAST</h1>
                  <p className="text-sm text-gray-600">Reservation Receipt</p>
                  <p className="text-xs text-gray-500 mt-1">Thank you for your reservation</p>
                </div>

                {/* Order Information */}
                <div className="mb-6">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500 font-medium mb-1">Order ID</p>
                      <p className="text-gray-900 font-mono text-xs break-all">{showFullReceipt.item.id}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium mb-1">Status</p>
                      <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-gray-900 text-white">
                        {getStatusDisplay(showFullReceipt.item.status)}
                      </span>
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium mb-1">Date Created</p>
                      <p className="text-gray-900">{new Date(showFullReceipt.item.created_at).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium mb-1">Quantity</p>
                      <p className="text-gray-900 font-semibold">{showFullReceipt.item.quantity} unit(s)</p>
                    </div>
                  </div>
                </div>

                {/* Product Details */}
                <div className="mb-6 border-t border-b border-gray-200 py-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Product Details</h3>
                  <div className="flex items-start gap-4">
                    {getProductImage(showFullReceipt.product) && (
                      <div className="w-20 h-20 bg-gray-100 rounded flex-shrink-0 overflow-hidden">
                        <Image
                          src={getProductImage(showFullReceipt.product)}
                          alt={showFullReceipt.product.name || "Product"}
                          width={80}
                          height={80}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 text-lg">{showFullReceipt.product.name}</p>
                      {showFullReceipt.item.meta?.branch && (
                        <p className="text-sm text-gray-600 mt-1">
                          <span className="font-medium">Branch:</span> {showFullReceipt.item.meta.branch}
                        </p>
                      )}
                      {getMetaFulfillmentMethod(showFullReceipt.item.meta) === "pickup" ? (
                        <p className="text-sm text-gray-600 mt-1">
                          <span className="font-medium">Pickup Address:</span> {String(showFullReceipt.item.meta?.pickup_address || PICKUP_ADDRESS)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Payment Summary */}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Payment Summary</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    {showFullReceipt.item.meta?.reservation_fee && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Delivery Fee</span>
                        <span className="text-gray-900 font-medium">₱{Number(showFullReceipt.item.meta.reservation_fee).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Unit Price</span>
                      <span className="text-gray-900 font-medium">₱{Number(showFullReceipt.item.meta?.product_price ?? showFullReceipt.product.price ?? 0).toLocaleString()}</span>
                    </div>
                    {showFullReceipt.item.meta?.addons_total && Number(showFullReceipt.item.meta.addons_total) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Add-ons</span>
                        <span className="text-gray-900 font-medium">₱{Number(showFullReceipt.item.meta.addons_total).toLocaleString()}</span>
                      </div>
                    )}
                    {showFullReceipt.item.meta?.discount_value && Number(showFullReceipt.item.meta.discount_value) > 0 && (
                      <div className="flex justify-between text-sm text-green-600">
                        <span>Discount</span>
                        <span className="font-medium">-₱{Number(showFullReceipt.item.meta.discount_value).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="border-t border-gray-300 pt-2 mt-2">
                      <div className="flex justify-between">
                        <span className="text-gray-900 font-bold text-lg">Total Amount</span>
                        <span className="text-gray-900 font-bold text-xl">₱{getItemTotalPrice(showFullReceipt.item, showFullReceipt.product).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Delivery Address */}
                {showFullReceipt.item.delivery_address_id && addressesById[showFullReceipt.item.delivery_address_id] && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Delivery Information</h3>
                    <div className="bg-gray-50 rounded-lg p-4 text-sm">
                      <p className="text-gray-900 font-medium">{addressesById[showFullReceipt.item.delivery_address_id].full_name}</p>
                      <p className="text-gray-600 mt-1">{addressesById[showFullReceipt.item.delivery_address_id].address}</p>
                      <p className="text-gray-600">{addressesById[showFullReceipt.item.delivery_address_id].phone}</p>
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                  <p className="text-xs text-gray-500 mb-2">
                    This is an official receipt from Grand East. For inquiries, please contact our customer service.
                  </p>
                  <p className="text-xs text-gray-400">
                    Generated on {new Date().toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default function ProfileReservePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading reservations...</p>
        </div>
      </div>
    }>
      <ProfileReservePageContent />
    </Suspense>
  );
}