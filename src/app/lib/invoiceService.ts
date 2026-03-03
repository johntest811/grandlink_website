import { createClient } from "@supabase/supabase-js";
import { getMailFrom, getMailTransporter } from "./mailer";
import { InvoiceData, InvoiceLine, renderInvoiceHtml, renderInvoicePdf } from "./invoice";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email) ? email : null;
}

function buildInvoiceNumber(userItemId: string, issuedAt = new Date()) {
  const y = issuedAt.getFullYear();
  const m = String(issuedAt.getMonth() + 1).padStart(2, "0");
  const d = String(issuedAt.getDate()).padStart(2, "0");
  const short = userItemId.replace(/-/g, "").slice(0, 10).toUpperCase();
  return `GL-${y}${m}${d}-${short}`;
}

export async function ensureInvoiceForUserItem(userItemId: string) {
  // 1) If exists, return it.
  const { data: existing } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("user_item_id", userItemId)
    .maybeSingle();

  if (existing) return existing;

  // 2) Load user_item
  const { data: item, error: itemErr } = await supabaseAdmin
    .from("user_items")
    .select("*")
    .eq("id", userItemId)
    .single();
  if (itemErr || !item) throw new Error(itemErr?.message || "Order not found");

  // 3) Load product
  const { data: product } = await supabaseAdmin
    .from("products")
    .select("id,name,price")
    .eq("id", item.product_id)
    .maybeSingle();

  // 4) Load address if present
  let deliveryAddressText: string | undefined;
  let addressEmail: string | null = null;
  if (item.delivery_address_id) {
    const { data: addr } = await supabaseAdmin
      .from("addresses")
      .select("address,full_name,phone,first_name,last_name,email")
      .eq("id", item.delivery_address_id)
      .maybeSingle();
    if (addr) {
      const name = addr.full_name || [addr.first_name, addr.last_name].filter(Boolean).join(" ");
      deliveryAddressText = `${name ? name + " — " : ""}${addr.address || ""}${addr.phone ? " — " + addr.phone : ""}`;
      addressEmail = normalizeEmail((addr as any).email);
    }
  }

  // 5) Resolve invoice recipients
  const billingEmail = normalizeEmail(item.meta?.billing_email || item.customer_email || item.meta?.customer_email || null);
  let authEmail: string | null = null;
  try {
    const { data: userWrap } = await supabaseAdmin.auth.admin.getUserById(item.user_id);
    authEmail = normalizeEmail(userWrap?.user?.email || null);
  } catch {
    authEmail = null;
  }

  const recipients = Array.from(
    new Set([
      billingEmail,
      addressEmail,
      authEmail,
    ].filter((v): v is string => Boolean(v)))
  );

  const issuedAtIso = new Date().toISOString();
  const invoiceNumber = buildInvoiceNumber(userItemId);

  // Prefer explicit amounts from DB/meta
  const qty = Number(item.quantity || 1);
  const unit = Number(item.price || item.meta?.unit_price || product?.price || item.meta?.product_price || 0);
  const subtotal = Number(item.meta?.subtotal ?? unit * qty);
  const addonsTotal = Number(item.meta?.addons_total ?? 0);
  const discountValue = Number(item.meta?.discount_value ?? item.meta?.voucher_discount ?? 0);
  const reservationFee = Number(item.meta?.reservation_fee ?? item.reservation_fee ?? 500);
  const totalAmount = Number(item.total_amount ?? item.total_paid ?? Math.max(0, subtotal + addonsTotal - discountValue + reservationFee));

  const deliveryMethod = String(item.meta?.delivery_method || item.meta?.fulfillment_method || "delivery");
  const pickupBranch = item.meta?.selected_branch || item.meta?.branch || undefined;

  const line: InvoiceLine = {
    description: product?.name || item.meta?.product_name || "Product",
    quantity: qty,
    unitPrice: unit,
    amount: unit * qty,
  };

  const invoiceData: InvoiceData = {
    invoiceNumber,
    issuedAtIso,
    companyName: "GrandLink Glass and Aluminium",
    companyAddress: "Philippines",
    companyEmail: "support@grandlink.com",
    customerName: item.meta?.billing_name || item.customer_name || item.meta?.customer_name || item.meta?.full_name || "",
    customerEmail: recipients[0] || "",
    customerPhone: item.meta?.billing_phone || item.customer_phone || item.meta?.customer_phone || "",
    billingAddress: item.delivery_address || item.meta?.billing_address || "",
    deliveryMethod,
    deliveryAddress: deliveryAddressText || item.delivery_address || item.meta?.delivery_address || "",
    pickupBranch,
    orderId: userItemId,
    paymentMethod: item.payment_method || item.meta?.payment_method || item.meta?.payment_provider || "",
    currency: "PHP",
    subtotal,
    addonsTotal,
    discountValue,
    reservationFee,
    totalAmount,
    lines: [line],
  };

  const invoiceHtml = renderInvoiceHtml(invoiceData);

  const insertPayload = {
    user_item_id: userItemId,
    user_id: item.user_id,
    invoice_number: invoiceNumber,
    currency: "PHP",
    subtotal,
    addons_total: addonsTotal,
    discount_value: discountValue,
    reservation_fee: reservationFee,
    total_amount: totalAmount,
    payment_method: invoiceData.paymentMethod || null,
    issued_at: issuedAtIso,
    invoice_html: invoiceHtml,
    meta: {
      delivery_method: deliveryMethod,
      pickup_branch: pickupBranch || null,
      delivery_address: invoiceData.deliveryAddress || null,
      product_id: item.product_id,
      product_name: line.description,
      quantity: qty,
    },
  };

  const { data: created, error: insErr } = await supabaseAdmin
    .from("invoices")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insErr || !created) throw new Error(insErr?.message || "Failed to create invoice");

  // Send email (best-effort)
  try {
    const transporter = getMailTransporter();
    if (transporter && recipients.length > 0) {
      const pdfBuffer = await renderInvoicePdf(invoiceData);

      await transporter.sendMail({
        from: getMailFrom(),
        to: recipients.join(","),
        subject: `Invoice ${invoiceNumber} - GrandLink`,
        html: invoiceHtml,
        attachments: [
          {
            filename: `${invoiceNumber}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      await supabaseAdmin
        .from("invoices")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", created.id);
    }
  } catch (e) {
    // Do not fail invoice creation if email fails
    console.warn("Invoice email send failed", e);
  }

  return created;
}
