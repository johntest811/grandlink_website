import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureInvoiceForUserItem } from '@/app/lib/invoiceService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const payrexNode = require('payrex-node');

const PAYREX_SECRET_KEY = process.env.PAYREX_SECRET_KEY;
const PAYREX_WEBHOOK_SECRET_KEY = process.env.PAYREX_WEBHOOK_SECRET_KEY;

let payrexClient: any | null = null;
function getPayrexClient() {
  if (!PAYREX_SECRET_KEY) {
    throw new Error('PAYREX_SECRET_KEY is not set on the server');
  }
  if (!payrexClient) {
    payrexClient = payrexNode(PAYREX_SECRET_KEY);
  }
  return payrexClient;
}

function normalizeChannel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('gcash')) return 'gcash';
  if (normalized.includes('maya')) return 'paymaya';
  if (normalized.includes('card')) return 'card';
  if (normalized.includes('qrph')) return 'qrph';
  return normalized;
}

function detectPayrexChannel(resource: any): string | null {
  const candidates: any[] = [
    resource?.payment_method?.type,
    resource?.payment_method_used?.type,
    resource?.payment_method?.payment_method_type,
    resource?.payment_method?.payment_method,
    resource?.payment_method?.type,
    resource?.type,
  ];

  const raw = candidates.find((c) => typeof c === 'string' && c.trim().length > 0) as string | undefined;
  return normalizeChannel(raw);
}

type PayrexBillingDetails = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length ? t : null;
}

function normalizeEmail(value: unknown): string | null {
  const t = normalizeText(value);
  if (!t) return null;
  const e = t.toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(e) ? e : null;
}

function extractBillingDetailsFromResource(resource: any): PayrexBillingDetails {
  const billing = resource?.billing || resource?.billing_details || resource?.billingDetails || null;
  const customer = resource?.customer || null;

  // PayRex PaymentEntity exposes `billing` and `customer`.
  const name =
    normalizeText(billing?.name) ||
    normalizeText(billing?.full_name) ||
    normalizeText(customer?.name) ||
    null;

  const email =
    normalizeEmail(billing?.email) ||
    normalizeEmail(billing?.email_address) ||
    normalizeEmail(customer?.email) ||
    normalizeEmail(customer?.email_address) ||
    null;

  const phone =
    normalizeText(billing?.phone) ||
    normalizeText(billing?.phone_number) ||
    normalizeText(customer?.phone) ||
    normalizeText(customer?.phone_number) ||
    null;

  return { name, email, phone };
}

async function resolvePayrexBillingDetails(payrex: any, resource: any, eventType?: string): Promise<PayrexBillingDetails> {
  const fromEvent = extractBillingDetailsFromResource(resource);
  if (fromEvent.email || fromEvent.phone || fromEvent.name) return fromEvent;

  const resourceId = typeof resource?.id === 'string' ? resource.id : null;
  if (!resourceId) return fromEvent;

  // Best-effort hydration: events can sometimes include a minimal payload.
  try {
    // If it's a Payment ID, this will return PaymentEntity with `billing`.
    const payment = await payrex.payments.retrieve(resourceId);
    const fromPayment = extractBillingDetailsFromResource(payment);
    if (fromPayment.email || fromPayment.phone || fromPayment.name) return fromPayment;
  } catch {
    // ignore
  }

  if (eventType && String(eventType).includes('payment_intent')) {
    try {
      const pi = await payrex.paymentIntents.retrieve(resourceId);
      const latestPaymentId = (pi as any)?.latestPayment || (pi as any)?.latest_payment;
      if (typeof latestPaymentId === 'string' && latestPaymentId.trim()) {
        const payment = await payrex.payments.retrieve(latestPaymentId.trim());
        const fromLatestPayment = extractBillingDetailsFromResource(payment);
        if (fromLatestPayment.email || fromLatestPayment.phone || fromLatestPayment.name) return fromLatestPayment;
      }
    } catch {
      // ignore
    }
  }

  return fromEvent;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    console.log('📦 PayRex webhook received');

    if (!PAYREX_WEBHOOK_SECRET_KEY) {
      console.error('❌ PAYREX_WEBHOOK_SECRET_KEY is not set on the server');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    const signatureHeader = request.headers.get('Payrex-Signature') || '';
    const rawPayload = await request.text();

    const payrex = getPayrexClient();

    let event: any;
    try {
      event = await payrex.webhooks.parseEvent(rawPayload, signatureHeader, PAYREX_WEBHOOK_SECRET_KEY);
    } catch (err: any) {
      console.error('❌ PayRex webhook verification failed:', err?.name || err);
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
    }

    const eventType: string | undefined = event?.type;
    const resource = event?.data?.resource ?? event?.data;
    const metadata = resource?.metadata || {};

    if (eventType !== 'payment.paid' && eventType !== 'payment_intent.succeeded') {
      return NextResponse.json({ status: 'ignored' });
    }

    const paymentId = resource?.id || event?.id || 'unknown';
    const amountPaid = Number(resource?.amount || 0) / 100;
    const payrexChannel = detectPayrexChannel(resource);

    const payrexBilling = await resolvePayrexBillingDetails(payrex, resource, eventType);

    const userItemIdsCsv = metadata?.user_item_ids || '';
    const ids: string[] = String(userItemIdsCsv)
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    const subtotal = Number(metadata?.subtotal || 0);
    const addonsTotal = Number(metadata?.addons_total || 0);
    const discountValue = Number(metadata?.discount_value || 0);
    const paymentType = metadata?.payment_type || 'order';
    const reservationFee = Number(metadata?.reservation_fee || (paymentType === 'reservation' ? 500 : 0));
    const totalAmount = Number(metadata?.total_amount || amountPaid);

    console.log('🔍 Processing PayRex payment for items:', ids);
    console.log('💰 Amount paid:', amountPaid, 'Total:', totalAmount);
    console.log('📦 Payment type:', paymentType);
    if (payrexChannel) console.log('💳 PayRex channel:', payrexChannel);

    if (ids.length === 0) {
      console.error('❌ No user_item_id(s) in webhook data');
      return NextResponse.json({ error: 'Invalid webhook data' }, { status: 400 });
    }

    const notifiedItems: { id: string; product_id: string; quantity: number; total_paid: number; user_id?: string }[] = [];
    let grandTotalPaid = 0;
    let cartUserId: string | null = null;

    for (const id of ids) {
      const { data: userItem } = await supabase
        .from('user_items')
        .select('user_id, product_id, quantity, meta, reservation_fee, item_type, order_status, delivery_address_id, price, status')
        .eq('id', id)
        .single();

      if (!userItem) {
        console.warn(`⚠️ Item ${id} not found`);
        continue;
      }

      const isCartItem = userItem.item_type === 'cart';
      const isReservation = userItem.item_type === 'reservation';

      if (!isCartItem && !isReservation) {
        console.warn(`⚠️ Item ${id} is neither cart nor reservation (type: ${userItem.item_type})`);
        continue;
      }

      if (!cartUserId) cartUserId = userItem.user_id;

      const itemMeta = userItem.meta || {};
      const lineAfterDiscount = Number(itemMeta.line_total_after_discount ?? itemMeta.line_total ?? 0);
      const addonsPerItem = Number(itemMeta.addons_total_per_item ?? itemMeta.addons_total ?? 0);
      const storedShare = Number(itemMeta.reservation_fee_share ?? 0);
      const fallbackShare = ids.length > 0 ? reservationFee / ids.length : reservationFee;
      const reservationShareRaw = storedShare || fallbackShare;
      const reservationShare = Number(reservationShareRaw.toFixed(2));
      const storedFinal = Number(itemMeta.final_total_per_item ?? 0);
      const computedFinal = lineAfterDiscount + reservationShare;
      const finalTotalPerItem = Number((storedFinal > 0 ? storedFinal : computedFinal).toFixed(2));

      grandTotalPaid += finalTotalPerItem;

      const updateData: any = {
        status: 'pending_payment',
        order_status: 'pending_payment',
        price: Number(userItem.price || 0),
        payment_status: 'completed',
        payment_id: paymentId,
        total_paid: finalTotalPerItem,
        total_amount: finalTotalPerItem,
        reservation_fee: reservationFee,

        payment_method: 'payrex',

        meta: {
          ...itemMeta,
          ...(payrexBilling?.name ? { billing_name: payrexBilling.name, customer_name: payrexBilling.name } : {}),
          ...(payrexBilling?.email ? { billing_email: payrexBilling.email, customer_email: payrexBilling.email } : {}),
          ...(payrexBilling?.phone ? { billing_phone: payrexBilling.phone, customer_phone: payrexBilling.phone } : {}),
          payment_confirmed_at: new Date().toISOString(),
          amount_paid: finalTotalPerItem,
          net_line_after_discount: lineAfterDiscount,
          total_amount: finalTotalPerItem,
          payment_session_id: paymentId,
          payment_method: 'payrex',
          // Keep `paymongo_channel` for backward compatibility with existing UI.
          paymongo_channel: payrexChannel,
          payrex_channel: payrexChannel,
          payment_provider: 'payrex',
          payrex_event_type: eventType,
          payrex_event_id: event?.id,

          subtotal,
          addons_total: addonsTotal,
          addons_total_per_item: addonsPerItem,
          discount_value: discountValue,
          reservation_fee: reservationFee,
          reservation_fee_share: reservationShare,
          final_total_per_item: finalTotalPerItem,
          payment_type: paymentType,
        },
        updated_at: new Date().toISOString(),
      };

      if (isCartItem) {
        updateData.item_type = 'reservation';
      }

      const { error: updateErr } = await supabase.from('user_items').update(updateData).eq('id', id);
      if (updateErr) {
        console.error(`❌ Failed to update item ${id}:`, updateErr);
      } else {
        try {
          if (itemMeta?.inventory_deducted) {
            console.log(`ℹ️ Inventory already deducted for item ${id}, skipping.`);
          } else {
            const { data: product, error: productErr } = await supabase
              .from('products')
              .select('inventory')
              .eq('id', userItem.product_id)
              .single();

            if (product && !productErr) {
              const newInventory = Math.max(0, product.inventory - userItem.quantity);
              const { error: inventoryErr } = await supabase
                .from('products')
                .update({ inventory: newInventory })
                .eq('id', userItem.product_id);

              if (inventoryErr) {
                console.error(`❌ Failed to deduct inventory for product ${userItem.product_id}:`, inventoryErr);
              } else {
                const nextMeta = {
                  ...itemMeta,
                  inventory_deducted: true,
                  product_stock_before: product.inventory,
                  product_stock_after: newInventory,
                };
                await supabase.from('user_items').update({ meta: nextMeta }).eq('id', id);
              }
            }
          }
        } catch (invErr) {
          console.error(`❌ Inventory deduction error for product ${userItem.product_id}:`, invErr);
        }
      }

      notifiedItems.push({
        id,
        product_id: userItem.product_id,
        quantity: userItem.quantity,
        total_paid: finalTotalPerItem,
        user_id: userItem.user_id,
      });

      try {
        await ensureInvoiceForUserItem(id);
      } catch (e) {
        console.warn('Invoice generation failed for', id, e);
      }
    }

    if (cartUserId) {
      try {
        const cartIdsToDelete: string[] = [];
        for (const id of ids) {
          const { data: userItem } = await supabase.from('user_items').select('meta').eq('id', id).single();
          if (userItem?.meta?.cart_id) {
            cartIdsToDelete.push(userItem.meta.cart_id);
          }
        }

        if (cartIdsToDelete.length > 0) {
          const { error: clearErr } = await supabase.from('cart').delete().in('id', cartIdsToDelete);
          if (clearErr) {
            console.warn('⚠️ Failed to clear cart:', clearErr.message);
          }
        }
      } catch (e) {
        console.warn('⚠️ Cart clear error:', e);
      }
    }

    if (notifiedItems.length) {
      const paymentLabel = paymentType === 'reservation' ? 'Reservation payment' : 'Order payment';
      const notificationTitle = paymentType === 'reservation' ? 'Reservation Paid' : 'Order Paid';
      const channelLabel = payrexChannel ? ` (${String(payrexChannel).toUpperCase()})` : '';
      const adminMessage = `${paymentLabel} received via PayRex${channelLabel}. Items: ${notifiedItems.length}. Amount: ₱${Number(grandTotalPaid || amountPaid || 0).toLocaleString()}`;

      const { error: adminNotifErr } = await supabase.from('notifications').insert({
        title: notificationTitle,
        message: adminMessage,
        type: 'order',
        priority: 'high',
        recipient_role: 'admin',
        is_read: false,
        created_at: new Date().toISOString(),
        metadata: {
          payment_provider: 'payrex',
          payment_type: paymentType,
          amount_paid: grandTotalPaid || amountPaid,
          paymongo_channel: payrexChannel,
          subtotal,
          addons_total: addonsTotal,
          discount_value: discountValue,
          reservation_fee: reservationFee,
          user_item_ids: ids,
          payment_id: paymentId,
        },
      });

      if (adminNotifErr) {
        console.error('❌ Failed to store admin notification:', adminNotifErr.message);
      }
    }

    console.log('✅ PayRex webhook processed');
    return NextResponse.json({ status: 'success' });
  } catch (error: any) {
    console.error('💥 Webhook processing error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
