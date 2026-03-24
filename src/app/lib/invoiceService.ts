import { createClient } from "@supabase/supabase-js";
import { getInvoiceMailFrom, getInvoiceMailTransporter } from "./mailer";
import { InvoiceData, InvoiceLine, renderInvoiceHtml, renderInvoicePdf } from "./invoice";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type InvoiceRecord = {
  id: string;
  invoice_number: string;
  issued_at?: string | null;
};

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

function getCompanyLogoUrl() {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  return `${baseUrl.replace(/\/$/, "")}/ge-logo.avif`;
}

async function prepareInvoicePayload(userItemId: string, existingInvoice?: InvoiceRecord | null) {
  const { data: item, error: itemErr } = await supabaseAdmin
    .from("user_items")
    .select("*")
    .eq("id", userItemId)
    .single();
  if (itemErr || !item) throw new Error(itemErr?.message || "Order not found");

  const { data: product } = await supabaseAdmin
    .from("products")
    .select("id,name,price")
    .eq("id", item.product_id)
    .maybeSingle();

  let deliveryAddressText: string | undefined;
  let addressEmail: string | null = null;
  const hydrateAddress = (addr: any) => {
    const name = addr?.full_name || [addr?.first_name, addr?.last_name].filter(Boolean).join(" ");
    deliveryAddressText = `${name ? name + " — " : ""}${addr?.address || ""}${addr?.phone ? " — " + addr.phone : ""}`;
    addressEmail = normalizeEmail(addr?.email);
  };

  if (item.delivery_address_id) {
    const { data: addr } = await supabaseAdmin
      .from("addresses")
      .select("address,full_name,phone,first_name,last_name,email")
      .eq("id", item.delivery_address_id)
      .maybeSingle();
    if (addr) {
      hydrateAddress(addr);
    }
  }

  // Pickup orders often have no delivery_address_id; fallback to the user's default/newest address.
  if (!addressEmail) {
    const { data: fallbackAddr } = await supabaseAdmin
      .from("addresses")
      .select("address,full_name,phone,first_name,last_name,email")
      .eq("user_id", item.user_id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallbackAddr) {
      hydrateAddress(fallbackAddr);
    }
  }

  const billingEmail = normalizeEmail(item.meta?.billing_email || item.customer_email || item.meta?.customer_email || null);
  let authEmail: string | null = null;
  try {
    const { data: userWrap } = await supabaseAdmin.auth.admin.getUserById(item.user_id);
    authEmail = normalizeEmail(userWrap?.user?.email || null);
  } catch {
    authEmail = null;
  }

  const primaryRecipient = addressEmail || billingEmail || authEmail;
  const recipients = primaryRecipient ? [primaryRecipient] : [];

  const issuedAtIso = existingInvoice?.issued_at || new Date().toISOString();
  const invoiceNumber = existingInvoice?.invoice_number || buildInvoiceNumber(userItemId, new Date(issuedAtIso));

  const qty = Number(item.quantity || 1);
  const unit = Number(item.price || item.meta?.unit_price || product?.price || item.meta?.product_price || 0);
  const subtotal = Number(item.meta?.subtotal ?? unit * qty);
  const addonsTotal = Number(item.meta?.addons_total ?? 0);
  const discountValue = Number(item.meta?.discount_value ?? item.meta?.voucher_discount ?? 0);
  const reservationFee = Number(item.meta?.reservation_fee ?? item.reservation_fee ?? 2599);
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
    companyLogoUrl: getCompanyLogoUrl(),
    companyAddress: "Philippines",
    companyEmail: "support@grandlink.com",
    customerName: item.meta?.billing_name || item.customer_name || item.meta?.customer_name || item.meta?.full_name || "",
    customerEmail: addressEmail || billingEmail || authEmail || "",
    customerPhone: item.meta?.billing_phone || item.customer_phone || item.meta?.customer_phone || "",
    billingAddress: deliveryAddressText || item.delivery_address || item.meta?.billing_address || "",
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

  return {
    item,
    recipients,
    invoiceData,
    invoiceHtml,
    insertPayload: {
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
        recipient_email: primaryRecipient,
      },
    },
  };
}

async function sendInvoiceEmail(options: {
  invoiceId: string;
  recipients: string[];
  invoiceData: InvoiceData;
  invoiceHtml: string;
}) {
  const { invoiceId, recipients, invoiceData, invoiceHtml } = options;
  const transporter = getInvoiceMailTransporter();
  if (!transporter || recipients.length === 0) return false;

  const pdfBuffer = await renderInvoicePdf(invoiceData);
  const receiptSummaryHtml = `
    <div style="margin:0 0 16px 0; padding:12px; border:1px solid #e5e7eb; border-radius:8px; background:#f9fafb;">
      <div style="font-weight:700; margin-bottom:6px;">Payment Receipt Summary</div>
      <div>Order ID: ${invoiceData.orderId}</div>
      <div>Invoice No: ${invoiceData.invoiceNumber}</div>
      <div>Total Paid: ${invoiceData.currency} ${invoiceData.totalAmount.toLocaleString()}</div>
      <div>Payment Method: ${invoiceData.paymentMethod || "N/A"}</div>
    </div>
  `;

  await transporter.sendMail({
    from: getInvoiceMailFrom(),
    to: recipients.join(","),
    subject: `GrandLink Receipt and Invoice ${invoiceData.invoiceNumber}`,
    html: `${receiptSummaryHtml}${invoiceHtml}`,
    attachments: [
      {
        filename: `${invoiceData.invoiceNumber}-receipt-invoice.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  await supabaseAdmin
    .from("invoices")
    .update({ email_sent_at: new Date().toISOString(), invoice_html: invoiceHtml })
    .eq("id", invoiceId);

  return true;
}

export async function ensureInvoiceForUserItem(userItemId: string) {
  // 1) If exists, return it.
  const { data: existing } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("user_item_id", userItemId)
    .maybeSingle();

  if (existing) return existing;
  const prepared = await prepareInvoicePayload(userItemId);

  const insertPayload = {
    ...prepared.insertPayload,
  };

  const { data: created, error: insErr } = await supabaseAdmin
    .from("invoices")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insErr || !created) throw new Error(insErr?.message || "Failed to create invoice");

  // Send email (best-effort)
  try {
    await sendInvoiceEmail({
      invoiceId: created.id,
      recipients: prepared.recipients,
      invoiceData: prepared.invoiceData,
      invoiceHtml: prepared.invoiceHtml,
    });
  } catch (e) {
    // Do not fail invoice creation if email fails
    console.warn("Invoice email send failed", e);
  }

  return created;
}

export async function resendInvoiceEmailForUserItem(userItemId: string) {
  const { data: existing } = await supabaseAdmin
    .from("invoices")
    .select("id,invoice_number,issued_at")
    .eq("user_item_id", userItemId)
    .maybeSingle();

  if (!existing) {
    const prepared = await prepareInvoicePayload(userItemId);
    const created = await ensureInvoiceForUserItem(userItemId);
    return {
      invoice: created,
      emailSent: Boolean((created as any)?.email_sent_at),
      recipientEmails: prepared.recipients,
    };
  }

  const prepared = await prepareInvoicePayload(userItemId, existing as InvoiceRecord);

  await supabaseAdmin
    .from("invoices")
    .update({
      ...prepared.insertPayload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  const emailSent = await sendInvoiceEmail({
    invoiceId: existing.id,
    recipients: prepared.recipients,
    invoiceData: prepared.invoiceData,
    invoiceHtml: prepared.invoiceHtml,
  });

  const { data: refreshed } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("id", existing.id)
    .single();

  return { invoice: refreshed, emailSent, recipientEmails: prepared.recipients };
}
