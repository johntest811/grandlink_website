import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureInvoiceForUserItem } from '@/app/lib/invoiceService';
import { getMailFrom, getMailTransporter } from '@/app/lib/mailer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://grandlnik-website.vercel.app';

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
  if (normalized.includes('card')) return 'card';
  return normalized;
}

export async function POST(request: NextRequest) {
  try {
    console.log('📦 PayMongo webhook received');
    const payload = await request.json();
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
      const reservationFee = Number(meta?.reservation_fee || (paymentType === 'reservation' ? 2599 : 0));
      const totalAmount = Number(meta?.total_amount || amountPaid);

      console.log('🔍 Processing payment for items:', ids);
      console.log('💰 Amount paid:', amountPaid, 'Total:', totalAmount);
      console.log('📦 Payment type:', paymentType);
      console.log('🎫 Reservation fee:', reservationFee);
      if (paymongoChannel) console.log('💳 PayMongo channel:', paymongoChannel);

      if (ids.length === 0) {
        console.error('❌ No user_item_id(s) in webhook data');
        return NextResponse.json({ error: 'Invalid webhook data' }, { status: 400 });
      }

      const notifiedItems: { id: string; product_id: string; product_name: string; product_image?: string | null; quantity: number; total_paid: number; user_id?: string }[] = [];
      let grandTotalPaid = 0;
      let cartUserId: string | null = null;

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

        const itemMeta = userItem.meta || {};
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
        const finalTotalPerItem = Number((storedFinal > 0 ? storedFinal : computedFinal).toFixed(2));

        grandTotalPaid += finalTotalPerItem;

        // Prepare update data
        const updateData: any = {
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
        });

        // Generate invoice (best-effort)
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
          if (transporter && cartUserId) {
            const { data: userWrap } = await supabase.auth.admin.getUserById(cartUserId);
            const recipientEmail = userWrap?.user?.email;

            if (recipientEmail) {
              const itemCards = notifiedItems
                .map(
                  (item) =>
                    `<div style="display:flex;gap:16px;align-items:flex-start;padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;margin-top:12px;">
                      ${item.product_image ? `<img src="${escapeHtml(item.product_image)}" alt="${escapeHtml(item.product_name)}" style="width:96px;height:96px;object-fit:cover;border-radius:12px;border:1px solid #e5e7eb;flex-shrink:0;" />` : ''}
                      <div style="flex:1;min-width:0;">
                        <div style="font-size:16px;font-weight:700;color:#111827;">${escapeHtml(item.product_name)}</div>
                        <div style="margin-top:6px;font-size:13px;color:#4b5563;">Quantity: ${escapeHtml(item.quantity)}</div>
                        <div style="margin-top:4px;font-size:13px;color:#4b5563;">Amount: ₱${Number(item.total_paid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    </div>`
                )
                .join('');

              const itemRows = notifiedItems
                .map(
                  (item) =>
                    `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(item.product_name)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${item.quantity}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">₱${Number(item.total_paid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`
                )
                .join('');

              await transporter.sendMail({
                from: getMailFrom(),
                to: recipientEmail,
                subject: `Payment Confirmed - ${paymentLabel}`,
                html: `
                  <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;background:#f9fafb;padding:24px;border-radius:20px;">
                    <h2 style="margin-bottom:8px;color:#111827;">Payment Confirmed</h2>
                    <p style="margin-top:0;color:#444;">Your payment has been received successfully via PayMongo${channelLabel}.</p>
                    <div style="margin-top:18px;">
                      <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:8px;">Purchased items</div>
                      ${itemCards}
                    </div>
                    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;">
                      <thead>
                        <tr>
                          <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">Item</th>
                          <th style="text-align:right;padding:8px;border-bottom:2px solid #e5e7eb;">Qty</th>
                          <th style="text-align:right;padding:8px;border-bottom:2px solid #e5e7eb;">Amount</th>
                        </tr>
                      </thead>
                      <tbody>${itemRows}</tbody>
                    </table>
                    <p style="margin-top:14px;font-weight:700;">Total Paid: ₱${Number(grandTotalPaid || amountPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p style="margin-top:6px;color:#666;font-size:12px;">Invoice emails are sent separately for each purchased item.</p>
                  </div>
                `,
              });
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