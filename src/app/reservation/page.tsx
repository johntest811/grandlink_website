"use client";

import { Suspense, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSearchParams, useRouter } from "next/navigation";
import { computeMeasurementPricing } from "../../utils/measurementPricing";
import {
  buildAddressPayloads,
  emptyAddressForm,
  formatAddressLineFromRecord,
  isAddressColumnError,
  toAddressFormFromRecord,
  type AddressFormFields,
} from "@/utils/addressFields";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DELIVERY_FEE = 2599;

type Product = {
  id: string;
  name: string;
  fullproductname?: string;
  description?: string;
  price: number;
  inventory: number;
  width?: number;
  height?: number;
  thickness?: number;
  material?: string;
  type?: string;
  category?: string;
  additionalfeatures?: string;
  image1?: string;
  images?: string[];
};

type Address = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name: string;
  phone: string;
  email?: string | null;
  address: string;
  full_address?: string | null;
  province?: string | null;
  city?: string | null;
  postal_code?: string | null;
  label?: string | null;
  is_default: boolean;
};

type VoucherInfo = { code: string; type: "percent" | "amount"; value: number };

function ReservationPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const productId = searchParams.get("productId");

  const [product, setProduct] = useState<Product | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [showAddressPopup, setShowAddressPopup] = useState(false);
  const [addressFormMode, setAddressFormMode] = useState<"add" | "edit" | null>(null);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressFormFields>(emptyAddressForm());
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"delivery" | "pickup">("delivery");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    quantity: 1,
    customWidth: "",
    customHeight: "",
    customThickness: "",
    specialInstructions: "",
    colorCustomization: false,
    colorText: "",
  });
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<VoucherInfo | null>(null);
  const [applyingVoucher, setApplyingVoucher] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"paymongo" | "paypal">(
    "paymongo"
  );

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

  const handleGoBack = () => {
    if (productId) router.push(`/Product/details?id=${productId}`);
    else router.push("/Product");
  };

  const resetAddressForm = () => {
    setAddressForm(emptyAddressForm());
  };

  const fetchAddresses = async (uid: string, preferredAddressId?: string | null) => {
    const { data: addressData } = await supabase
      .from("addresses")
      .select("*")
      .eq("user_id", uid)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    const list = (addressData || []) as Address[];
    setAddresses(list);

    setSelectedAddressId((prev) => {
      if (preferredAddressId && list.some((a) => a.id === preferredAddressId)) {
        return preferredAddressId;
      }
      if (prev && list.some((a) => a.id === prev)) {
        return prev;
      }
      const def = list.find((a) => a.is_default);
      return def?.id || list[0]?.id || "";
    });
  };

  const openAddressListPopup = () => {
    setAddressFormMode(null);
    setEditingAddressId(null);
    resetAddressForm();
    setShowAddressPopup(true);
  };

  const openAddAddressForm = () => {
    setAddressFormMode("add");
    setEditingAddressId(null);
    resetAddressForm();
    setShowAddressPopup(true);
  };

  const openEditAddressForm = (addr: Address) => {
    setAddressFormMode("edit");
    setEditingAddressId(addr.id);
    setAddressForm(toAddressFormFromRecord(addr));
    setShowAddressPopup(true);
  };

  const saveAddressFromPopup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      alert("Please sign in first.");
      return;
    }
    if (
      !addressForm.full_name.trim() ||
      !addressForm.email.trim() ||
      !addressForm.phone.trim() ||
      !addressForm.street.trim() ||
      !addressForm.barangay.trim() ||
      !addressForm.city.trim() ||
      !addressForm.province.trim() ||
      !addressForm.postal_code.trim()
    ) {
      alert("Please complete all required address fields.");
      return;
    }

    setAddressSaving(true);
    try {
      const { basePayload, extendedPayload } = buildAddressPayloads(addressForm);
      if (!basePayload.address) {
        alert("Please provide a valid full address.");
        return;
      }

      if (editingAddressId) {
        if (addressForm.is_default) {
          await supabase
            .from("addresses")
            .update({ is_default: false })
            .eq("user_id", userId)
            .neq("id", editingAddressId);
        }

        let { error: updateError } = await supabase
          .from("addresses")
          .update({
            ...extendedPayload,
            is_default: !!addressForm.is_default,
          })
          .match({ id: editingAddressId, user_id: userId });

        if (updateError && isAddressColumnError(updateError.message || "")) {
          const fallback = await supabase
            .from("addresses")
            .update({
              ...basePayload,
              is_default: !!addressForm.is_default,
            })
            .match({ id: editingAddressId, user_id: userId });
          updateError = fallback.error;
        }

        if (updateError) throw updateError;
        await fetchAddresses(userId, editingAddressId);
      } else {
        const wantDefault = addressForm.is_default || addresses.length === 0;

        let insertResult = await supabase
          .from("addresses")
          .insert([
            {
              user_id: userId,
              ...extendedPayload,
              is_default: false,
            },
          ])
          .select("id")
          .single();

        if (insertResult.error && isAddressColumnError(insertResult.error.message || "")) {
          insertResult = await supabase
            .from("addresses")
            .insert([
              {
                user_id: userId,
                ...basePayload,
                is_default: false,
              },
            ])
            .select("id")
            .single();
        }

        if (insertResult.error) throw insertResult.error;

        if (wantDefault && insertResult.data?.id) {
          await supabase.from("addresses").update({ is_default: false }).eq("user_id", userId);
          await supabase
            .from("addresses")
            .update({ is_default: true })
            .match({ id: insertResult.data.id, user_id: userId });
        }

        await fetchAddresses(userId, insertResult.data?.id || null);
      }

      setAddressFormMode(null);
      setEditingAddressId(null);
      resetAddressForm();
    } catch (error: any) {
      alert(error?.message || "Failed to save address.");
    } finally {
      setAddressSaving(false);
    }
  };

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

        if (productId) {
          const { data: productData, error: productError } = await supabase
            .from("products")
            .select("*")
            .eq("id", productId)
            .single();
          if (productError) throw productError;
          setProduct(productData as any);
        }

        await fetchAddresses(uid);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [productId, router]);

  const qty = Math.max(1, Number(formData.quantity || 1));
  const selectedAddressPreview = addresses.find((a) => a.id === selectedAddressId) || null;

  const measurementPricing = (() => {
    const unitPricePerSqm = Number(product?.price || 0);

    const baseWmm = Number(product?.width || 0);
    const baseHmm = Number(product?.height || 0);
    const baseWidthM = Number.isFinite(baseWmm) && baseWmm > 0 ? baseWmm / 1000 : undefined;
    const baseHeightM = Number.isFinite(baseHmm) && baseHmm > 0 ? baseHmm / 1000 : undefined;

    const widthMeters = formData.customWidth ? Number(formData.customWidth) : baseWidthM;
    const heightMeters = formData.customHeight ? Number(formData.customHeight) : baseHeightM;

    return computeMeasurementPricing({
      widthMeters,
      heightMeters,
      unitPricePerSqm,
      minSqm: 1,
      sqmDecimals: 2,
    });
  })();

  const computedUnitPrice = measurementPricing.unit_price;
  const productSubtotal = computedUnitPrice * qty;
  const addonsTotal = formData.colorCustomization ? 2500 * qty : 0;
  const preDiscount = productSubtotal + addonsTotal;
  const discountValue = voucherInfo
    ? voucherInfo.type === "percent"
      ? Math.min(preDiscount, preDiscount * (voucherInfo.value / 100))
      : Math.min(preDiscount, voucherInfo.value)
    : 0;
  const discountedTotal = Math.max(0, preDiscount - discountValue);
  const reservationFee = DELIVERY_FEE;
  const balanceDue = Math.max(0, discountedTotal - reservationFee);

  const applyVoucher = async () => {
    if (preDiscount <= 0) {
      alert("Please set quantity first.");
      return;
    }
    setApplyingVoucher(true);
    try {
      const res = await fetch("/api/discount-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: voucherCode.trim(),
          subtotal: preDiscount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Invalid code");
      setVoucherInfo(data.discount);
    } catch (e: any) {
      alert(e.message);
      setVoucherInfo(null);
    } finally {
      setApplyingVoucher(false);
    }
  };

  const addToCartInstead = async () => {
    if (!userId || !product) return;
    try {
      const addons = formData.colorCustomization
        ? [
            {
              key: "color_customization",
              label: "Color Customization",
              fee: 2500,
              // Do not prefill text; leave empty until user types
              value: formData.colorText || "",
            },
          ]
        : [];
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          productId: product.id,
          quantity: qty,
          meta: {
            custom_dimensions: {
              width: measurementPricing.width_m,
              height: measurementPricing.height_m,
            },
            addons,
            voucher_code: voucherInfo?.code || null,
            voucher_discount: discountValue,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to add to cart");
      router.push("/profile/cart");
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleReservation = async () => {
    if (!userId || !product) {
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
    if (product.inventory < qty) {
      alert("Insufficient inventory for this quantity");
      return;
    }
    setSubmitting(true);
    try {
      const selectedAddress = fulfillmentMethod === "delivery" ? addresses.find((a) => a.id === selectedAddressId) : null;
      if (fulfillmentMethod === "delivery" && !selectedAddress) throw new Error("Selected address not found");

      const addons = formData.colorCustomization
        ? [
            {
              key: "color_customization",
              label: "Color Customization",
              fee: 2500,
              value: formData.colorText || "",
            },
          ]
        : [];

      const userItemData = {
        user_id: userId,
        product_id: product.id,
        item_type: "reservation",
        status: "pending_payment",
        quantity: qty,
        delivery_address_id: fulfillmentMethod === "delivery" ? selectedAddressId : null,
        special_instructions: formData.specialInstructions || null,
        payment_status: "pending",
        reservation_fee: reservationFee,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        meta: {
          product_name: product.name,
          product_fullname: product.fullproductname,
          product_price: computedUnitPrice,
          product_price_base: product.price,
          product_category: product.category,
          product_type: product.type,
          product_material: product.material,
          product_description: product.description,
          additional_features: product.additionalfeatures,
          payment_method: paymentMethod,
          delivery_method: fulfillmentMethod,
          selected_branch: fulfillmentMethod === "pickup" ? selectedBranch : null,
          custom_dimensions: {
            width: measurementPricing.width_m,
            height: measurementPricing.height_m,
          },
          pricing: {
            unit_price: computedUnitPrice,
            unit_price_per_sqm: Number(product.price || 0),
            sqm_raw: measurementPricing.sqm_raw,
            sqm_rounded: measurementPricing.sqm_rounded,
            sqm_billable: measurementPricing.sqm_billable,
            base_width_mm: product.width,
            base_height_mm: product.height,
            custom_width_m: measurementPricing.width_m,
            custom_height_m: measurementPricing.height_m,
          },
          delivery_address: selectedAddress
            ? {
                first_name: selectedAddress.first_name,
                last_name: selectedAddress.last_name,
                full_name: selectedAddress.full_name,
                phone: selectedAddress.phone,
                email: selectedAddress.email,
                province: selectedAddress.province,
                city: selectedAddress.city,
                barangay: selectedAddress.label,
                postal_code: selectedAddress.postal_code,
                address: formatAddressLineFromRecord(selectedAddress),
              }
            : null,
          addons,
          subtotal: productSubtotal,
          addons_total: addonsTotal,
          discount_value: discountValue,
          total_amount: discountedTotal,
          reservation_fee: reservationFee,
          balance_due: balanceDue,
          voucher_code: voucherInfo?.code || null,
          created_by: "user",
          reservation_created_at: new Date().toISOString(),
        },
      };

      const { data: userItem, error: userItemError } = await supabase
        .from("user_items")
        .insert([userItemData as any])
        .select()
        .single();

      if (userItemError) throw new Error(`Database error: ${userItemError.message}`);

      // IMPORTANT: send user_item_ids array to the API
      const paymentPayload = {
        user_item_ids: [userItem.id],
        payment_method: paymentMethod,
        payment_type: "reservation",
        delivery_method: fulfillmentMethod,
        delivery_address_id: fulfillmentMethod === "delivery" ? selectedAddressId : null,
        branch: fulfillmentMethod === "pickup" ? selectedBranch : null,
        success_url: `${window.location.origin}/reservation/success?reservation_id=${userItem.id}`,
        cancel_url: `${window.location.origin}/reservation?productId=${product.id}`,
        voucher: voucherInfo || undefined,
      };

      const response = await fetch("/api/create-payment-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentPayload),
      });
      const { checkoutUrl, sessionId, error: paymentError } = await response.json();
      if (paymentError || !checkoutUrl)
        throw new Error(paymentError || "Payment session creation failed");

      await supabase.from("payment_sessions").insert({
        user_id: userId,
        user_item_id: userItem.id,
        stripe_session_id: sessionId,
        amount: reservationFee,
        currency: paymentMethod === "paypal" ? "USD" : "PHP",
        status: "pending",
        payment_type: "reservation",
        payment_provider: paymentMethod,
        created_at: new Date().toISOString(),
      });

      window.location.href = checkoutUrl;
    } catch (error: any) {
      alert("Error creating reservation: " + (error?.message || "Unknown error occurred"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="container mx-auto px-4">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="container mx-auto px-4">
          <div className="text-center">Product not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <button
          onClick={handleGoBack}
          className="flex items-center gap-2 text-gray-700 hover:text-[#8B1C1C] mb-3"
        >
          <span>←</span> Back to Product
        </button>

        <h1 className="text-2xl md:text-3xl font-bold text-center text-black mb-4">
          Reserve Your Product
        </h1>

        <div className="bg-white rounded-lg shadow-lg p-6 md:p-8 text-black">
          <div className="flex flex-col md:flex-row gap-8">
            {/* Left */}
            <div className="flex-1">
              <div className="w-full aspect-[16/9] bg-gray-100 rounded overflow-hidden mb-4">
                <img
                  src={
                    (product?.images && product.images[0]) ||
                    product?.image1 ||
                    "/no-orders.png"
                  }
                  alt={product?.name || "Product"}
                  className="w-full h-full object-cover"
                />
              </div>

              <h2 className="text-2xl font-bold">{product.name}</h2>
              <div className="text-gray-600 mt-1">{product.fullproductname || ""}</div>

              <div className="mt-3 flex items-center gap-3">
                <div className="text-2xl font-extrabold text-green-600">
                  ₱{Number(product.price).toLocaleString()}
                </div>
                <span className="text-xs px-2 py-1 bg-gray-100 rounded">
                  Stock: {product.inventory}
                </span>
              </div>

              <div className="mt-6">
                <h3 className="font-semibold text-gray-800 mb-2">Description</h3>
                <p className="text-gray-700 text-sm leading-6">
                  {product.description || "—"}
                </p>
              </div>

              <div className="mt-6">
                <h3 className="font-semibold text-gray-800 mb-2">
                  Product Specifications
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm text-gray-700">
                  <div>
                    <span className="text-gray-500">Category:</span>{" "}
                    {product.category || "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">Type:</span>{" "}
                    {product.type || "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">Material:</span>{" "}
                    {product.material || "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">Width:</span>{" "}
                    {product.width ?? "—"} cm
                  </div>
                  <div>
                    <span className="text-gray-500">Height:</span>{" "}
                    {product.height ?? "—"} cm
                  </div>
                  <div>
                    <span className="text-gray-500">Thickness:</span>{" "}
                    {product.thickness ?? "—"} cm
                  </div>
                </div>
              </div>

              {!!product.additionalfeatures && (
                <div className="mt-6">
                  <h3 className="font-semibold text-gray-800 mb-2">
                    Additional Features
                  </h3>
                  <ul className="list-disc ml-6 text-sm text-gray-700 whitespace-pre-line">
                    {String(product.additionalfeatures)
                      .split("\n")
                      .filter(Boolean)
                      .map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right */}
            <div className="w-full md:w-80">
              <h2 className="text-lg font-semibold mb-3">Reservation Details</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        quantity: Math.max(1, Number(e.target.value || 1)),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-600">Fulfillment Method *</label>
                  <div className="flex gap-4 mt-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="fulfillmentMethod"
                        value="delivery"
                        checked={fulfillmentMethod === "delivery"}
                        onChange={() => setFulfillmentMethod("delivery")}
                      />
                      Delivery
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="fulfillmentMethod"
                        value="pickup"
                        checked={fulfillmentMethod === "pickup"}
                        onChange={() => setFulfillmentMethod("pickup")}
                      />
                      Pickup
                    </label>
                  </div>
                </div>

                {fulfillmentMethod === "delivery" ? (
                  <div>
                    <label className="text-sm text-gray-600">Delivery Address *</label>
                    <select
                      className="w-full border rounded px-3 py-2"
                      value={selectedAddressId}
                      onChange={(e) => setSelectedAddressId(e.target.value)}
                    >
                      <option value="">Select Address</option>
                      {addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name} — {formatAddressLineFromRecord(a)}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={openAddressListPopup}
                        className="px-3 py-1.5 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        Manage Addresses
                      </button>
                      <button
                        type="button"
                        onClick={openAddAddressForm}
                        className="px-3 py-1.5 rounded bg-[#8B1C1C] text-sm text-white hover:bg-[#7a1919]"
                      >
                        + Add New Address
                      </button>
                    </div>
                    {selectedAddressPreview ? (
                      <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                        <div className="font-semibold text-gray-900">{selectedAddressPreview.full_name}</div>
                        <div>{selectedAddressPreview.phone}</div>
                        <div>{formatAddressLineFromRecord(selectedAddressPreview)}</div>
                        {selectedAddressPreview.email ? <div>{selectedAddressPreview.email}</div> : null}
                      </div>
                    ) : null}
                    {addresses.length === 0 ? (
                      <div className="mt-1 text-xs text-gray-600">No saved addresses yet. Add one to continue delivery checkout.</div>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <label className="text-sm text-gray-600">Store Branch *</label>
                    <select
                      className="w-full border rounded px-3 py-2"
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                    >
                      <option value="">Select Store Branch</option>
                      {branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-sm text-gray-600">
                    Custom Measurements (meters, optional)
                  </label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Width (m)"
                      className="border rounded px-2 py-2"
                      value={formData.customWidth}
                      onChange={(e) =>
                        setFormData({ ...formData, customWidth: e.target.value })
                      }
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Height (m)"
                      className="border rounded px-2 py-2"
                      value={formData.customHeight}
                      onChange={(e) =>
                        setFormData({ ...formData, customHeight: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.colorCustomization}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          colorCustomization: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm">
                      Color Customization (+₱2,500 per unit)
                    </span>
                  </label>
                  {formData.colorCustomization && (
                    <input
                      placeholder="Enter desired color"
                      className="mt-2 w-full border rounded px-3 py-2"
                      value={formData.colorText}
                      onChange={(e) =>
                        setFormData({ ...formData, colorText: e.target.value })
                      }
                    />
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-600">Special Instructions</label>
                  <textarea
                    className="w-full border rounded px-3 py-2"
                    rows={3}
                    value={formData.specialInstructions}
                    onChange={(e) =>
                      setFormData({ ...formData, specialInstructions: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-600">Discount Code</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      className="flex-1 border rounded px-3 py-2"
                      placeholder="Enter voucher code"
                      value={voucherCode}
                      onChange={(e) => setVoucherCode(e.target.value)}
                    />
                    <button
                      onClick={applyVoucher}
                      disabled={applyingVoucher}
                      className="px-4 py-2 bg-[#8B1C1C] text-white rounded disabled:opacity-60"
                    >
                      {applyingVoucher ? "Applying..." : "Apply"}
                    </button>
                  </div>
                  {voucherInfo && (
                    <div className="text-xs text-green-700 mt-2">
                      Applied {voucherInfo.code} (
                      {voucherInfo.type === "percent"
                        ? `${voucherInfo.value}%`
                        : `₱${voucherInfo.value.toLocaleString()}`}
                      )
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-600">Payment Method</label>
                  <div className="flex gap-4 mt-1">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="pmethod"
                        checked={paymentMethod === "paymongo"}
                        onChange={() => setPaymentMethod("paymongo")}
                      />
                      <span className="text-sm">PayMongo - GCash, Maya</span>
                    </label>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Contact details (phone/email) will be collected inside the PayMongo checkout.
                  </div>
                  <div className="flex gap-4 mt-1">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="pmethod"
                        checked={paymentMethod === "paypal"}
                        onChange={() => setPaymentMethod("paypal")}
                      />
                      <span className="text-sm">PayPal</span>
                    </label>
                  </div>
                </div>

                <div className="mt-4">
                  <h3 className="font-semibold mb-2">Reservation Summary</h3>
                  <div className="bg-gray-50 rounded p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Product Subtotal</span>
                      <span>₱{productSubtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Add-ons</span>
                      <span>₱{addonsTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Discount</span>
                      <span className="text-green-700">
                        -₱{Number(discountValue).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Product Value</span>
                      <span>₱{discountedTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Delivery Fee (Pay now)</span>
                      <span className="font-medium text-green-600">
                        ₱{reservationFee.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Remaining Balance</span>
                      <span>₱{balanceDue.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <button
                    onClick={handleReservation}
                    disabled={submitting}
                    className="w-full bg-[#8B1C1C] text-white rounded px-4 py-2 disabled:opacity-60"
                  >
                    {submitting ? "Processing…" : "Pay Delivery Fee & Reserve"}
                  </button>
                  <button
                    onClick={addToCartInstead}
                    className="w-full bg-gray-200 text-black rounded px-4 py-2 hover:bg-gray-300"
                  >
                    Add to Cart Instead
                  </button>
                </div>
              </div>
            </div>
            {/* Right end */}
          </div>
        </div>
      </div>

      {showAddressPopup && (
        <div className="fixed inset-0 z-[10000] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">
                {addressFormMode ? (addressFormMode === "edit" ? "Edit Address" : "Add New Address") : "Select Delivery Address"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowAddressPopup(false);
                  setAddressFormMode(null);
                  setEditingAddressId(null);
                  resetAddressForm();
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            {addressFormMode ? (
              <form onSubmit={saveAddressFromPopup} className="p-5 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <input
                      value={addressForm.full_name}
                      onChange={(e) => setAddressForm((prev) => ({ ...prev, full_name: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Gmail *</label>
                    <input
                      type="email"
                      value={addressForm.email}
                      onChange={(e) => setAddressForm((prev) => ({ ...prev, email: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                  <input
                    value={addressForm.phone}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-gray-900"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Province / Region *</label>
                    <input
                      value={addressForm.province}
                      onChange={(e) => setAddressForm((prev) => ({ ...prev, province: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                    <input
                      value={addressForm.city}
                      onChange={(e) => setAddressForm((prev) => ({ ...prev, city: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Barangay *</label>
                    <input
                      value={addressForm.barangay}
                      onChange={(e) => setAddressForm((prev) => ({ ...prev, barangay: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Postal Code *</label>
                    <input
                      value={addressForm.postal_code}
                      onChange={(e) => setAddressForm((prev) => ({ ...prev, postal_code: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Street *</label>
                  <textarea
                    value={addressForm.street}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, street: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-gray-900"
                    rows={3}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Address Preview</label>
                  <input
                    value={`${addressForm.street}${addressForm.barangay ? `, ${addressForm.barangay}` : ""}${addressForm.city ? `, ${addressForm.city}` : ""}${addressForm.province ? `, ${addressForm.province}` : ""}${addressForm.postal_code ? `, ${addressForm.postal_code}` : ""}`}
                    className="w-full border rounded px-3 py-2 text-gray-900"
                    readOnly
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={addressForm.is_default}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                  />
                  Set as default address
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddressFormMode(null);
                      setEditingAddressId(null);
                      resetAddressForm();
                    }}
                    className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-100"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={addressSaving}
                    className="px-4 py-2 bg-[#8B1C1C] text-white rounded hover:bg-[#7a1919] disabled:opacity-60"
                  >
                    {addressSaving ? "Saving..." : "Save Address"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-5">
                <div className="flex justify-end mb-3">
                  <button
                    type="button"
                    onClick={openAddAddressForm}
                    className="px-3 py-2 rounded bg-[#8B1C1C] text-white text-sm hover:bg-[#7a1919]"
                  >
                    + Add New Address
                  </button>
                </div>

                <div className="space-y-3">
                  {addresses.map((addr) => {
                    const isSelected = selectedAddressId === addr.id;
                    return (
                      <div
                        key={addr.id}
                        className={`rounded-lg border p-3 ${isSelected ? "border-[#8B1C1C] bg-[#fff8f8]" : "border-gray-200 bg-white"}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-gray-900">
                              {addr.full_name}
                              {addr.is_default ? (
                                <span className="ml-2 text-xs font-medium text-green-700">Default</span>
                              ) : null}
                            </div>
                            <div className="text-sm text-gray-700">{addr.phone}</div>
                            <div className="text-sm text-gray-700">{formatAddressLineFromRecord(addr)}</div>
                            {addr.email ? <div className="text-xs text-gray-600">{addr.email}</div> : null}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAddressId(addr.id);
                                setShowAddressPopup(false);
                              }}
                              className="px-3 py-1.5 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              Select
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditAddressForm(addr)}
                              className="px-3 py-1.5 rounded border border-[#8B1C1C] text-sm text-[#8B1C1C] hover:bg-[#fff1f1]"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {addresses.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600 text-center">
                      No saved addresses yet.
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReservationPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading reservation...</div>}>
      <ReservationPageContent />
    </Suspense>
  );
}
