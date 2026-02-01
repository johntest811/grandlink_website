import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureInvoiceForUserItem } from '@/app/lib/invoiceService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_ENVIRONMENT = process.env.PAYPAL_ENVIRONMENT || 'sandbox';
const PAYPAL_BASE_URL = PAYPAL_ENVIRONMENT === 'sandbox' 
  ? 'https://api-m.sandbox.paypal.com' 
  : 'https://api-m.paypal.com';

async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials'
  });

  const data = await response.json();
  return data.access_token;
}

async function verifyPayPalWebhook(headers: any, body: any, webhookId: string) {
  // PayPal webhook verification logic
  // This is a simplified version - in production, implement full webhook verification
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event_type, resource } = body;

    console.log('PayPal webhook received:', event_type);

    // Handle PayPal payment completion
    if (event_type === 'CHECKOUT.ORDER.APPROVED' || event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = resource.id || resource.supplementary_data?.related_ids?.order_id;
      
      if (!orderId) {
        console.error('No order ID in PayPal webhook');
        return NextResponse.json({ error: 'Invalid webhook data' }, { status: 400 });
      }

      // Get order details from PayPal
      const accessToken = await getPayPalAccessToken();
      const orderResponse = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!orderResponse.ok) {
        console.error('Failed to get PayPal order details');
        return NextResponse.json({ error: 'Failed to verify payment' }, { status: 500 });
      }

      const orderData = await orderResponse.json();
      const userItemIdsCsv = orderData.purchase_units?.[0]?.custom_id || orderData.purchase_units?.[0]?.reference_id;
      const ids = String(userItemIdsCsv || "").split(",").map((s: string) => s.trim()).filter(Boolean);

      console.log('🔍 Processing PayPal payment for items:', ids);

      if (ids.length === 0) {
        console.error('❌ No user_item_id in PayPal order');
        return NextResponse.json({ error: 'Invalid order data' }, { status: 400 });
      }

      const notifiedItems: { id: string; product_id: string; quantity: number; total_paid: number; user_id?: string }[] = [];
      let grandTotal = 0; // accumulate total for admin notify
      let orderSubtotal = 0;
      let orderAddonsTotal = 0;
      let orderDiscountValue = 0;
      let orderReservationFee = 0;
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
        const reservationFee = Number(itemMeta.reservation_fee ?? userItem.reservation_fee ?? 500);
        const subtotal = Number(itemMeta.subtotal ?? 0);
        const addonsTotal = Number(itemMeta.addons_total ?? 0);
        const discountValue = Number(itemMeta.discount_value ?? 0);
        const lineAfterDiscount = Number(itemMeta.line_total_after_discount ?? itemMeta.line_total ?? 0);
        const addonsPerItem = Number(itemMeta.addons_total_per_item ?? itemMeta.addons_total ?? 0);
        const storedShare = Number(itemMeta.reservation_fee_share ?? 0);
        const fallbackShare = ids.length > 0 ? reservationFee / ids.length : reservationFee;
        const reservationShareRaw = storedShare || fallbackShare;
        const reservationShare = Number(reservationShareRaw.toFixed(2));
        const storedFinal = Number(itemMeta.final_total_per_item ?? 0);
        const computedFinal = lineAfterDiscount + reservationShare;
        const finalTotalPerItem = Number((storedFinal > 0 ? storedFinal : computedFinal).toFixed(2));

        grandTotal += finalTotalPerItem;
  if (orderSubtotal === 0) orderSubtotal = subtotal;
  if (orderAddonsTotal === 0) orderAddonsTotal = addonsTotal;
  if (orderDiscountValue === 0) orderDiscountValue = discountValue;
  if (orderReservationFee === 0) orderReservationFee = reservationFee;

        // Prepare update data
        const updateData: any = {
          status: 'pending_payment',
          order_status: 'pending_payment',
          payment_status: 'completed',
          payment_id: orderId,
          price: Number((userItem as any).price || 0),
          total_paid: finalTotalPerItem,
          // Persist the final total (after discount + addons + reservation share)
          total_amount: finalTotalPerItem,
          payment_method: 'paypal',
          meta: {
            ...itemMeta,
            payment_confirmed_at: new Date().toISOString(),
            payment_method: 'paypal',
            paypal_order_id: orderId,
            subtotal,
            addons_total: addonsTotal,
            discount_value: discountValue,
            // Store both the net product line and the final total for transparency
            net_line_after_discount: lineAfterDiscount,
            total_amount: finalTotalPerItem,
            reservation_fee: reservationFee,
            reservation_fee_share: reservationShare,
            addons_total_per_item: addonsPerItem,
            final_total_per_item: finalTotalPerItem,
            payment_type: itemMeta.payment_type ?? 'reservation',
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
                  console.log(`✅ Deducted ${userItem.quantity} from product ${userItem.product_id} inventory (${product.inventory} → ${newInventory})`);
                  // Mark item meta to avoid double deduction in retries
                  const nextMeta = {
                    ...itemMeta,
                    inventory_deducted: true,
                    product_stock_before: product.inventory,
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
          quantity: userItem.quantity,
          total_paid: finalTotalPerItem,
          user_id: userItem.user_id,
        });
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
        const paymentLabel = notifiedItems.length > 1 ? 'Reservation payments' : 'Reservation payment';
        const notificationTitle = notifiedItems.length > 1 ? 'Reservations Paid' : 'Reservation Paid';
        const adminMessage = `${paymentLabel} received via PayPal. Items: ${notifiedItems.length}. Amount: ₱${Number(grandTotal || 0).toLocaleString()}`;

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
            payment_provider: 'paypal',
            payment_type: 'reservation',
            amount_paid: grandTotal,
              subtotal: orderSubtotal,
              addons_total: orderAddonsTotal,
              discount_value: orderDiscountValue,
              reservation_fee: orderReservationFee,
            user_item_ids: ids,
          },
        }).select();

        if (adminNotifErr) {
          console.error('❌ Failed to store admin notification:', adminNotifErr.message);
        } else {
          console.log('✅ Admin notification inserted successfully:', insertedNotif);
        }
      }

      console.log('PayPal payment processed successfully for user_item:', userItemIdsCsv);
      return NextResponse.json({ status: 'success' });
    }

    return NextResponse.json({ status: 'ignored' });

  } catch (error: any) {
    console.error('PayPal webhook processing error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}