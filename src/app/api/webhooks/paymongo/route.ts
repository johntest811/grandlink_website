import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureInvoiceForUserItem } from '@/app/lib/invoiceService';
import { getMailFrom, getMailTransporter } from '@/app/lib/mailer';
import { normalizeFulfillmentMethod } from '@/utils/fulfillment';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://grandlnik-website.vercel.app';

function parsePaymongoSignatureHeader(value: string | null): { t?: string; te?: string; li?: string } {
  if (!value) return {};
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const out: { t?: string; te?: string; li?: string } = {};
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (key === 't') out.t = val;
    if (key === 'te') out.te = val;
    if (key === 'li') out.li = val;
  }
  return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, 'hex');
    const bBuf = Buffer.from(b, 'hex');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function computePaymongoSignatureHex(secret: string, timestamp: string, rawBody: string): string {
  const signedPayload = `${timestamp}.${rawBody}`;
  return crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
}

function shouldEnforceSignatureVerification(): boolean {
  // In local dev, allow running without a webhook secret.
  return process.env.NODE_ENV === 'production' || !!process.env.PAYMONGO_WEBHOOK_SECRET;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${BASE_URL}${trimmed}`;
  return null;
}

function getProductImage(itemMeta: Record<string, any>, productDetails?: Record<string, any> | null): string | null {
  const metaImages = Array.isArray(itemMeta?.images) ? itemMeta.images : [];
  const productImages = Array.isArray(productDetails?.images) ? productDetails.images : [];

  const candidates = [
    itemMeta?.product_image,
    itemMeta?.image,
    itemMeta?.image1,
    metaImages[0],
    productDetails?.image1,
    productDetails?.image2,
    productDetails?.image3,
    productDetails?.image4,
    productDetails?.image5,
    productImages[0],
  ];

  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function detectPayMongoChannel(payload: any): string | null {
  const data = payload?.data;
  const session = data?.attributes?.data;

  const candidates: any[] = [
    session?.attributes?.payment_method_used,
    session?.attributes?.payment_method_type,
    session?.attributes?.payment_method,
    session?.attributes?.payments?.data?.[0]?.attributes?.payment_method_details?.type,
    session?.attributes?.payments?.data?.[0]?.attributes?.source?.type,
    session?.attributes?.payments?.data?.[0]?.attributes?.source?.payment_method,
    data?.attributes?.payment_method_used,
    data?.attributes?.payment_method_type,
  ];

  const raw = candidates.find((c) => typeof c === 'string' && c.trim().length > 0) as string | undefined;
  if (!raw) return null;

  const normalized = raw.trim().toLowerCase();
  if (normalized.includes('gcash')) return 'gcash';
  if (normalized.includes('maya') || normalized.includes('paymaya')) return 'paymaya';
  if (normalized.includes('qrph')) return 'qrph';
  if (normalized.includes('card')) return 'card';
  return normalized;
}

function allocateCentsByWeights(totalCents: number, weights: number[]): number[] {
  const normalizedTotal = Math.max(0, Math.round(Number(totalCents || 0)));
  const size = Array.isArray(weights) ? weights.length : 0;
  if (size === 0) return [];
  if (normalizedTotal <= 0) return new Array(size).fill(0);

  const normalizedWeights = weights.map((value) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric);
  });
  const sumWeights = normalizedWeights.reduce((sum, value) => sum + value, 0);

  if (sumWeights <= 0) {
    const base = Math.floor(normalizedTotal / size);
    let remainder = normalizedTotal - base * size;
    return normalizedWeights.map(() => {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      return base + extra;
    });
  }

  if (sumWeights === normalizedTotal) {
    return normalizedWeights;
  }

  const provisional = normalizedWeights.map((weight, index) => {
    const exact = (normalizedTotal * weight) / sumWeights;
    const floorValue = Math.floor(exact);
    return {
      index,
      floorValue,
      remainder: exact - floorValue,
    };
  });

  const allocation = new Array(size).fill(0);
  let assigned = 0;
  provisional.forEach((entry) => {
    allocation[entry.index] = entry.floorValue;
    assigned += entry.floorValue;
  });

  let remaining = normalizedTotal - assigned;
  provisional
    .slice()
    .sort((left, right) => {
      if (right.remainder !== left.remainder) return right.remainder - left.remainder;
      return left.index - right.index;
    })
    .forEach((entry) => {
      if (remaining <= 0) return;
      allocation[entry.index] += 1;
      remaining -= 1;
    });

  return allocation;
}

async function resolveReceiptEmail(options: {
  userId: string;
  deliveryAddressId?: string | null;
}): Promise<string | null> {
  const { userId, deliveryAddressId } = options;

  const normalizeEmail = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const email = value.trim();
    if (!email) return null;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email) ? email : null;
  };

  // Prefer the selected delivery address email (the user inputs this on the Address page).
  if (deliveryAddressId) {
    const { data: addr } = await supabase
      .from('addresses')
      .select('email')
      .eq('id', deliveryAddressId)
      .maybeSingle();
    const email = normalizeEmail(addr?.email);
    if (email) return email;
  }

  // Fallback to default/newest address email.
  const { data: fallbackAddr } = await supabase
    .from('addresses')
    .select('email')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const fallbackEmail = normalizeEmail(fallbackAddr?.email);
  if (fallbackEmail) return fallbackEmail;

  // Final fallback: Supabase auth email.
  try {
    const { data: userWrap } = await supabase.auth.admin.getUserById(userId);
    return normalizeEmail(userWrap?.user?.email);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('📦 PayMongo webhook received');
    const rawBody = await request.text();

    // Verify PayMongo signature (recommended): https://developers.paymongo.com/docs/securing-webhook
    const signatureHeader = request.headers.get('paymongo-signature');
    const { t, te, li } = parsePaymongoSignatureHeader(signatureHeader);
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;

    if (shouldEnforceSignatureVerification()) {
      if (!secret) {
        console.error('❌ PAYMONGO_WEBHOOK_SECRET is not configured');
        return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
      }
      if (!t || (!te && !li)) {
        console.error('❌ Missing/invalid Paymongo-Signature header');
        return NextResponse.json({ error: 'Invalid signature header' }, { status: 400 });
      }

      const expected = computePaymongoSignatureHex(secret, t, rawBody);
      const provided = li || te || '';
      const ok = timingSafeEqualHex(expected, provided);
      if (!ok) {
        console.error('❌ Webhook signature verification failed');
        return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 });
      }
    }

    const payload = JSON.parse(rawBody);
    const data = payload?.data;

    const paymongoChannel = detectPayMongoChannel(payload);

    // PayMongo paid event
    if (data?.attributes?.type === 'checkout_session.payment.paid') {
      const session = data?.attributes?.data;
      const sessionId = data?.id || session?.id || data?.attributes?.reference_number || 'unknown';
      const amountPaid = (session?.attributes?.amount || data?.attributes?.amount || 0) / 100;

      const meta = session?.attributes?.metadata || {};
      const userItemIdsCsv =
        meta?.user_item_ids ||
        session?.attributes?.metadata?.user_item_ids ||
        '';
      const ids: string[] = String(userItemIdsCsv).split(',').map((s: string) => s.trim()).filter(Boolean);

      // Pull receipt context from metadata
      const subtotal = Number(meta?.subtotal || 0);
      const addonsTotal = Number(meta?.addons_total || 0);
      const discountValue = Number(meta?.discount_value || 0);
      const paymentType = meta?.payment_type || 'order';
      const deliveryMethod = normalizeFulfillmentMethod(
        meta?.delivery_method || meta?.fulfillment_method
      );
      const reservationFee = (() => {
        const explicit = meta?.reservation_fee;
        if (explicit !== null && typeof explicit !== 'undefined') return Number(explicit);
        if (paymentType === 'reservation' && deliveryMethod === 'delivery') return 2599;
        return 0;
      })();
      const totalAmount = Number(meta?.total_amount || amountPaid);
      const perItemSummaryRaw = meta?.per_item_summary_json;
      const perItemSummaryMap = new Map<string, number>();
      if (typeof perItemSummaryRaw === 'string' && perItemSummaryRaw.trim().length > 0) {
        try {
          const parsed = JSON.parse(perItemSummaryRaw);
          if (Array.isArray(parsed)) {
            parsed.forEach((entry: any) => {
              const id = typeof entry?.id === 'string' ? entry.id : '';
              const finalTotal = Number(entry?.final_total ?? 0);
              if (!id || !Number.isFinite(finalTotal) || finalTotal < 0) return;
              perItemSummaryMap.set(id, finalTotal);
            });
          }
        } catch {
          // Keep processing; fallback allocation handles malformed metadata.
        }
      }

      const expectedPerItemCents = ids.map((id) => {
        const expected = Number(perItemSummaryMap.get(id) ?? 0);
        if (!Number.isFinite(expected) || expected < 0) return 0;
        return Math.round(expected * 100);
      });
      const paidTotalCents = (() => {
        const fromProvider = Math.round(Number(amountPaid || 0) * 100);
        if (fromProvider > 0) return fromProvider;
        const fromMeta = Math.round(Number(totalAmount || 0) * 100);
        return Math.max(0, fromMeta);
      })();
      const allocatedPaidCents = allocateCentsByWeights(paidTotalCents, expectedPerItemCents);
      const paidTotalMap = new Map<string, number>();
      ids.forEach((id, index) => {
        paidTotalMap.set(id, Number(((allocatedPaidCents[index] || 0) / 100).toFixed(2)));
      });

      console.log('🔍 Processing payment for items:', ids);
      console.log('💰 Amount paid:', amountPaid, 'Total:', totalAmount);
      console.log('📦 Payment type:', paymentType);
      console.log('🎫 Reservation fee:', reservationFee);
      if (paymongoChannel) console.log('💳 PayMongo channel:', paymongoChannel);

      if (ids.length === 0) {
        console.error('❌ No user_item_id(s) in webhook data');
        return NextResponse.json({ error: 'Invalid webhook data' }, { status: 400 });
      }

      const notifiedItems: { id: string; product_id: string; product_name: string; product_image?: string | null; quantity: number; total_paid: number; user_id?: string; delivery_address_id?: string | null; meta?: Record<string, any> }[] = [];
      let grandTotalPaid = 0;
      let cartUserId: string | null = null;
      let firstUserId: string | null = null;
      let receiptAlreadySent = false;

      for (const id of ids) {
        // Try to find the item (could be cart or reservation)
        const { data: userItem } = await supabase
          .from('user_items')
          .select('user_id, product_id, quantity, meta, reservation_fee, item_type, order_status, delivery_address_id, price, status')
          .eq('id', id)
          .single();

        if (!userItem) {
          console.warn(`⚠️ Item ${id} not found`);
          continue;
        }

        // Determine if this is a cart item or already a reservation
        const isCartItem = userItem.item_type === 'cart';
        const isReservation = userItem.item_type === 'reservation';

        console.log(`📋 Item ${id}: type=${userItem.item_type}, status=${userItem.status}, isCart=${isCartItem}, isReservation=${isReservation}`);

        if (!isCartItem && !isReservation) {
          console.warn(`⚠️ Item ${id} is neither cart nor reservation (type: ${userItem.item_type})`);
          continue;
        }
        
        if (!cartUserId) cartUserId = userItem.user_id;
        if (!firstUserId) firstUserId = userItem.user_id;

        const itemMeta = userItem.meta || {};
        if (itemMeta?.receipt_email_sent_at) {
          receiptAlreadySent = true;
        }

        const { data: productDetails } = await supabase
          .from('products')
          .select('name,price,inventory,images,image1,image2,image3,image4,image5')
          .eq('id', userItem.product_id)
          .maybeSingle();
        const productName = String(itemMeta.product_name || productDetails?.name || 'Purchased Item');
        const productUnitPrice = Number(itemMeta.product_price ?? userItem.price ?? productDetails?.price ?? 0);
        const productImage = getProductImage(itemMeta, productDetails);
        const lineAfterDiscount = Number(itemMeta.line_total_after_discount ?? itemMeta.line_total ?? 0);
        const addonsPerItem = Number(itemMeta.addons_total_per_item ?? itemMeta.addons_total ?? 0);
        const storedShare = Number(itemMeta.reservation_fee_share ?? 0);
        const fallbackShare = ids.length > 0 ? reservationFee / ids.length : reservationFee;
        const reservationShareRaw = storedShare || fallbackShare;
        const reservationShare = Number(reservationShareRaw.toFixed(2));
        const storedFinal = Number(itemMeta.final_total_per_item ?? 0);
        const computedFinal = lineAfterDiscount + reservationShare;
        const fallbackFinalTotal = Number((storedFinal > 0 ? storedFinal : computedFinal).toFixed(2));
        const allocatedPaidTotal = paidTotalMap.get(id);
        const finalTotalPerItem = Number(
          ((typeof allocatedPaidTotal === 'number' && allocatedPaidTotal >= 0)
            ? allocatedPaidTotal
            : fallbackFinalTotal).toFixed(2)
        );

        grandTotalPaid += finalTotalPerItem;

        // Prepare update data
        const updateData: any = {
          // Payment is confirmed, but fulfillment must still pass admin approval first.
          status: 'pending_payment',
          order_status: 'pending_payment',
          price: Number(userItem.price || 0),
          payment_status: 'completed',
          payment_id: sessionId,
          total_paid: finalTotalPerItem,
          // Persist the final total (after discount + addons + reservation share)
          total_amount: finalTotalPerItem,
          reservation_fee: reservationFee,
          payment_method: 'paymongo',
          meta: {
            ...itemMeta,
            payment_confirmed_at: new Date().toISOString(),
            amount_paid: finalTotalPerItem,
            // Store both the net product line and the final total for transparency
            net_line_after_discount: lineAfterDiscount,
            product_name: productName,
            product_price: productUnitPrice,
            total_amount: finalTotalPerItem,
            payment_session_id: sessionId,
            payment_method: 'paymongo',
            paymongo_channel: paymongoChannel,
            paid_via_qrph: paymongoChannel === 'qrph',
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

        // If it's a cart item, convert it to reservation
        if (isCartItem) {
          updateData.item_type = 'reservation';
        }

        const { error: updateErr } = await supabase
          .from('user_items')
          .update(updateData)
          .eq('id', id);

        if (updateErr) {
          console.error(`❌ Failed to update item ${id}:`, updateErr);
        } else {
          const action = isCartItem ? 'Converted cart item' : 'Updated reservation';
          console.log(`✅ ${action} ${id} to pending_payment status`);

          // Deduct inventory from products table (idempotent: only once per item)
          try {
            if (itemMeta?.inventory_deducted) {
              console.log(`ℹ️ Inventory already deducted for item ${id}, skipping.`);
            } else {
            if (productDetails && typeof productDetails.inventory === 'number') {
              const newInventory = Math.max(0, productDetails.inventory - userItem.quantity);
              const { error: inventoryErr } = await supabase
                .from('products')
                .update({ inventory: newInventory })
                .eq('id', userItem.product_id);

              if (inventoryErr) {
                console.error(`❌ Failed to deduct inventory for product ${userItem.product_id}:`, inventoryErr);
              } else {
                console.log(`✅ Deducted ${userItem.quantity} from product ${userItem.product_id} inventory (${productDetails.inventory} → ${newInventory})`);
                // Mark item meta to avoid double deduction in retries
                const nextMeta = {
                  ...itemMeta,
                  inventory_deducted: true,
                  product_stock_before: productDetails.inventory,
                  product_stock_after: newInventory,
                };
                await supabase
                  .from('user_items')
                  .update({ meta: nextMeta })
                  .eq('id', id);
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
          product_name: productName,
          product_image: productImage,
          quantity: userItem.quantity,
          total_paid: finalTotalPerItem,
          user_id: userItem.user_id,
          delivery_address_id: userItem.delivery_address_id ?? null,
          meta: itemMeta,
        });

        // Pre-generate invoice record only (email is sent after admin approval).
        try {
          await ensureInvoiceForUserItem(id);
        } catch (e) {
          console.warn('Invoice generation failed for', id, e);
        }
      }

      // Clear cart table for items that came from cart (check metadata)
      if (cartUserId) {
        try {
          // Delete cart items associated with the paid user_items
          const cartIdsToDelete: string[] = [];
          for (const id of ids) {
            const { data: userItem } = await supabase
              .from('user_items')
              .select('meta')
              .eq('id', id)
              .single();
            
            if (userItem?.meta?.cart_id) {
              cartIdsToDelete.push(userItem.meta.cart_id);
            }
          }

          if (cartIdsToDelete.length > 0) {
            const { error: clearErr } = await supabase
              .from('cart')
              .delete()
              .in('id', cartIdsToDelete);
            
            if (clearErr) {
              console.warn('⚠️ Failed to clear cart:', clearErr.message);
            } else {
              console.log('✅ Cart items deleted:', cartIdsToDelete.length);
            }
          }
        } catch (e) {
          console.warn('⚠️ Cart clear error:', e);
        }
      }

      if (notifiedItems.length) {
        const paymentLabel = paymentType === 'reservation' ? 'Reservation payment' : 'Order payment';
        const notificationTitle = paymentType === 'reservation' ? 'Reservation Paid' : 'Order Paid';
        const channelLabel = paymongoChannel ? ` (${paymongoChannel.toUpperCase()})` : '';
        const adminMessage = `${paymentLabel} received via PayMongo${channelLabel}. Items: ${notifiedItems.length}. Amount: ₱${Number(grandTotalPaid || amountPaid || 0).toLocaleString()}`;

        console.log('📢 Inserting admin notification:', {
          title: notificationTitle,
          message: adminMessage,
          type: 'order',
          priority: 'high',
          recipient_role: 'admin',
        });

        const { data: insertedNotif, error: adminNotifErr } = await supabase.from('notifications').insert({
          title: notificationTitle,
          message: adminMessage,
          type: 'order',
          priority: 'high',
          recipient_role: 'admin',
          is_read: false,
          created_at: new Date().toISOString(),
          metadata: {
            payment_provider: 'paymongo',
            payment_type: paymentType,
            amount_paid: grandTotalPaid || amountPaid,
            paymongo_channel: paymongoChannel,
            subtotal,
            addons_total: addonsTotal,
            discount_value: discountValue,
            reservation_fee: reservationFee,
            user_item_ids: ids,
          },
        }).select();

        if (adminNotifErr) {
          console.error('❌ Failed to store admin notification:', adminNotifErr.message);
        } else {
          console.log('✅ Admin notification inserted successfully:', insertedNotif);
        }

        // Customer payment confirmation email (includes purchased items)
        try {
          const transporter = getMailTransporter();
          const userIdForReceipt = cartUserId || firstUserId;

          // Idempotency: avoid resending receipt if webhook retries.
          if (receiptAlreadySent) {
            console.log('ℹ️ Receipt already sent for at least one item; skipping customer receipt email');
            return;
          }

          if (transporter && userIdForReceipt) {
            const deliveryAddressId = notifiedItems.find((item) => item.user_id === userIdForReceipt)?.delivery_address_id;
            const recipientEmail = await resolveReceiptEmail({
              userId: userIdForReceipt,
              deliveryAddressId: deliveryAddressId ?? null,
            });

            if (recipientEmail) {
              const receiptLabel = paymongoChannel === 'qrph'
                ? 'QRPh receipt'
                : paymongoChannel
                ? `${paymongoChannel.toUpperCase()} receipt`
                : 'PayMongo receipt';

              const itemCards = notifiedItems
                .map(
                  (item) =>
                    `<div style="display:flex;gap:16px;align-items:flex-start;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;margin-top:12px;">
                      ${item.product_image ? `<img src="${escapeHtml(item.product_image)}" alt="${escapeHtml(item.product_name)}" style="width:96px;height:96px;object-fit:cover;border-radius:12px;border:1px solid #e5e7eb;flex-shrink:0;" />` : ''}
                      <div style="flex:1;min-width:0;">
                        <div style="font-size:15px;font-weight:700;color:#111827;">${escapeHtml(item.product_name)}</div>
                        <div style="margin-top:6px;font-size:13px;color:#374151;">Quantity: ${escapeHtml(item.quantity)}</div>
                        <div style="margin-top:4px;font-size:13px;color:#111827;font-weight:600;">Paid Amount: ₱${Number(item.total_paid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    </div>`
                )
                .join('');

              await transporter.sendMail({
                from: getMailFrom(),
                to: recipientEmail,
                subject: `Payment Confirmed (${receiptLabel}) - ${paymentLabel}`,
                html: `
                  <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;background:#f3f4f6;padding:24px;border-radius:16px;">
                    <div style="background:#16a34a;color:#fff;padding:24px;border-radius:12px;text-align:center;">
                      <div style="font-size:24px;font-weight:700;line-height:1.2;">Payment Successful</div>
                      <div style="font-size:14px;opacity:0.95;margin-top:6px;">Your reservation payment has been received via PayMongo${channelLabel}.</div>
                    </div>

                    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:16px;">
                      <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Reservation Receipt</div>
                      <div style="font-size:13px;color:#374151;line-height:1.7;">
                        <div><strong>Payment Reference:</strong> ${escapeHtml(sessionId)}</div>
                        <div><strong>Payment Method:</strong> PayMongo ${paymongoChannel ? `(${escapeHtml(paymongoChannel.toUpperCase())})` : ''}</div>
                        <div><strong>Items:</strong> ${notifiedItems.length}</div>
                        <div><strong>Total Paid:</strong> ₱${Number(grandTotalPaid || amountPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    </div>

                    <div style="margin-top:16px;">
                      <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:8px;">Purchased Items</div>
                      ${itemCards}
                    </div>

                    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:16px;">
                      <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:10px;">What's Next?</div>
                      <div style="font-size:13px;color:#374151;line-height:1.8;">
                        <div><strong>1.</strong> Your payment is confirmed and now waiting for admin approval.</div>
                        <div><strong>2.</strong> After approval, your order moves into production and delivery workflow.</div>
                        <div><strong>3.</strong> The official invoice PDF will be emailed once admin approves your order.</div>
                      </div>
                    </div>

                    <p style="margin-top:12px;color:#6b7280;font-size:12px;">This receipt confirms payment only. Final invoice is sent after admin approval.</p>
                  </div>
                `,
              });

              // Mark receipt as sent (best-effort) to prevent duplicate emails on webhook retries.
              try {
                const sentAt = new Date().toISOString();
                for (const item of notifiedItems) {
                  const nextMeta = {
                    ...(item.meta || {}),
                    receipt_email_sent_at: sentAt,
                    receipt_email_to: recipientEmail,
                  };
                  await supabase.from('user_items').update({
                    meta: nextMeta,
                    updated_at: sentAt,
                  }).eq('id', item.id);
                }
              } catch (markErr) {
                console.warn('⚠️ Failed to mark receipt as sent:', markErr);
              }
            }
          }
        } catch (emailErr) {
          console.warn('⚠️ Failed to send payment confirmation email:', emailErr);
        }
      }

      console.log('✅ PayMongo webhook processed');
      return NextResponse.json({ status: 'success' });
    }

    return NextResponse.json({ status: 'ignored' });
  } catch (error: any) {
    console.error('💥 Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}