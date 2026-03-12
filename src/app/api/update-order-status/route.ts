import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resendInvoiceEmailForUserItem } from "@/app/lib/invoiceService";
import { getMailFrom, getMailTransporter } from "@/app/lib/mailer";

// CORS headers (makes cross-origin safe if ever called from browser)
const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_ADMIN_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Preflight
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// Initialize service-role client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// NOTE: email sending is handled via the shared mailer (SendGrid-first, Gmail fallback).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email) ? email : null;
}

async function resolveOrderRecipientEmail(orderData: any) {
  let addressEmail: string | null = null;
  if (orderData?.delivery_address_id) {
    const { data: address } = await supabase
      .from("addresses")
      .select("email")
      .eq("id", orderData.delivery_address_id)
      .maybeSingle();

    addressEmail = normalizeEmail(address?.email ?? null);
  }

  const billingEmail = normalizeEmail(
    orderData?.meta?.billing_email ||
      orderData?.customer_email ||
      orderData?.meta?.customer_email ||
      null
  );

  const { data: userWrap } = await supabase.auth.admin.getUserById(orderData.user_id);
  const authEmail = normalizeEmail(userWrap?.user?.email || null);

  return {
    addressEmail,
    billingEmail,
    authEmail,
    recipientEmail: addressEmail || billingEmail || authEmail,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { userItemId, newStatus, adminName, adminNotes, estimatedDeliveryDate, skipUpdate } = await request.json();

    if (!userItemId || !newStatus) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: corsHeaders });
    }

    // Load order (and product basic info if needed)
    const { data: orderData, error: fetchError } = await supabase
      .from("user_items")
      .select("*")
      .eq("id", userItemId)
      .single();

    if (fetchError || !orderData) {
      console.error("Order fetch error:", fetchError);
      return NextResponse.json({ error: "Order not found" }, { status: 404, headers: corsHeaders });
    }

    // Map UI-only stages to valid DB status values (must pass user_items_status_check)
    const mapStatusForDB = (s: string) => {
      switch (s) {
        case "packaging":
          return "start_packaging";        // canonical DB value
        case "quality_check":
          return "in_production";
        case "out_for_delivery":
          return "ready_for_delivery";
        case "pending_balance_payment":
          return "reserved";
        default:
          return s;
      }
    };

    // Progress label map (legacy)
    const progressMap: Record<string, string> = {
      pending_payment: "awaiting_payment",
      reserved: "payment_confirmed",
      approved: "in_production",
      in_production: "in_production",
      quality_check: "quality_check",
      start_packaging: "packaging",
      packaging: "packaging",
      ready_for_delivery: "ready_for_delivery",
      out_for_delivery: "out_for_delivery",
      completed: "delivered",
      cancelled: "cancelled",
      pending_cancellation: "pending_cancellation",
      pending_balance_payment: "balance_due",
    };

    const dbStatus = mapStatusForDB(newStatus);
    const now = new Date().toISOString();

    // Only update DB if skipUpdate !== true (admin app already wrote the change)
    if (!skipUpdate) {
      const nextHistory = [
        ...((orderData as any).progress_history ?? []),
        { status: newStatus, updated_at: now, admin: adminName || null },
      ];

      const updatePayload: any = {
        status: dbStatus,
        order_status: newStatus,
        progress_history: nextHistory,
        updated_at: now,
      };
      if (adminNotes) updatePayload.admin_notes = adminNotes;
      if (estimatedDeliveryDate) updatePayload.estimated_delivery_date = estimatedDeliveryDate;

      const { error: updateError } = await supabase
        .from("user_items")
        .update(updatePayload)
        .eq("id", userItemId);

      if (updateError) {
        console.error("Update order error:", updateError);
        return NextResponse.json({ error: "Failed to update order" }, { status: 500, headers: corsHeaders });
      }
    }

    const recipientInfo = await resolveOrderRecipientEmail(orderData);
    const userEmail = recipientInfo.recipientEmail;

    const { data: preferences } = await supabase
      .from("user_notification_preferences")
      .select("*")
      .eq("user_id", orderData.user_id)
      .single();

    const shouldSendInApp = preferences?.order_status_notifications !== false;
    const shouldSendEmail = preferences?.email_notifications !== false;

    const statusMessages: Record<string, string> = {
      pending_payment: "Your order is awaiting payment confirmation.",
      reserved: "Your order has been reserved and payment confirmed.",
      pending_balance_payment: "Please settle the remaining balance so we can continue processing your order.",
      approved: "Your order has been approved and will begin production soon.",
      in_production: "Your order is currently being manufactured.",
      quality_check: "Your order is undergoing quality inspection.",
      start_packaging: "Your order is being packaged.",
      packaging: "Your order is being packaged.",
      ready_for_delivery: "Your order is ready for delivery! We will contact you soon.",
      out_for_delivery: "Your order is on its way to you!",
      completed: "Your order has been completed successfully. Thank you for choosing Grand Link!",
      cancelled: "Your order has been cancelled. If you have any questions, please contact us.",
      pending_cancellation: "Your cancellation request is being processed.",
    };

    const productName = orderData.meta?.product_name || "Your Order";
    const statusDisplay = newStatus.replace(/_/g, " ").toUpperCase();
    const message = statusMessages[newStatus] || `Your order status has been updated to: ${statusDisplay}`;

    if (shouldSendInApp) {
      const baseNotification: any = {
        user_id: orderData.user_id,
        title: `Order Status: ${statusDisplay}`,
        message: `${productName} - ${message}`,
        type: "order_status",
        metadata: {
          order_id: userItemId,
          product_id: orderData.product_id,
          product_name: productName,
          new_status: newStatus,
          admin_name: adminName || null,
        },
        action_url: `/profile/order`,
        order_id: userItemId,
        is_read: false,
        created_at: now,
      };

      const { error: notifError } = await supabase.from("user_notifications").insert(baseNotification);
      if (notifError) {
        console.error("Failed to insert user notification:", notifError);
      }
    }

    let invoiceEmailSent = false;
    let invoiceRecipientEmail = userEmail;
    if (newStatus === "approved") {
      try {
        const invoiceResult = await resendInvoiceEmailForUserItem(userItemId);
        invoiceEmailSent = Boolean(invoiceResult?.emailSent);
        invoiceRecipientEmail = invoiceResult?.recipientEmails?.[0] || userEmail;
      } catch (invoiceErr) {
        console.error("Invoice email send failed:", invoiceErr);
      }
    }

    let statusEmailSent = false;
    if (newStatus !== "approved" && shouldSendEmail && userEmail) {
      try {
        const transporter = getMailTransporter();
        if (transporter) {
          await transporter.sendMail({
            from: getMailFrom(),
            to: userEmail,
            subject: `Order Status: ${statusDisplay} - ${productName}`,
            html: `<p>${message}</p><p>Product: ${productName}</p><p>Order ID: ${userItemId}</p>`,
          });
          statusEmailSent = true;
        } else {
          console.warn("No mail transporter configured; skipping status email.");
        }
      } catch (mailErr) {
        console.error("Email send failed:", mailErr);
      }
    }

    await supabase.from("email_notifications").insert({
      recipient_email: newStatus === "approved" ? invoiceRecipientEmail : userEmail,
      subject: newStatus === "approved" ? `Invoice for approved order ${userItemId}` : `Order Status: ${statusDisplay}`,
      message:
        newStatus === "approved"
          ? `${productName} - Invoice email sent after admin approval.`
          : `${productName} - ${message}`,
      notification_type: "order_status",
      related_entity_type: "user_items",
      related_entity_id: userItemId,
      status:
        newStatus === "approved"
          ? invoiceEmailSent
            ? "sent"
            : invoiceRecipientEmail
            ? "pending"
            : "skipped"
          : shouldSendEmail && userEmail
          ? statusEmailSent
            ? "sent"
            : "pending"
          : "skipped",
      created_at: now,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Notification processed",
        invoiceEmailSent,
        statusEmailSent,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Order status update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}