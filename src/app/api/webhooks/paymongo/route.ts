import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureInvoiceForUserItem } from '@/app/lib/invoiceService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    console.log('📦 PayMongo webhook received');
    const payload = await request.json();
    const data = payload?.data;

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
      const reservationFee = Number(meta?.reservation_fee || (paymentType === 'reservation' ? 500 : 0));
      const totalAmount = Number(meta?.total_amount || amountPaid);

      console.log('🔍 Processing payment for items:', ids);
      console.log('💰 Amount paid:', amountPaid, 'Total:', totalAmount);
      console.log('📦 Payment type:', paymentType);
      console.log('🎫 Reservation fee:', reservationFee);

      if (ids.length === 0) {
        console.error('❌ No user_item_id(s) in webhook data');
        return NextResponse.json({ error: 'Invalid webhook data' }, { status: 400 });
      }

      const notifiedItems: { id: string; product_id: string; quantity: number; total_paid: number; user_id?: string }[] = [];
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
          order_progress: 'payment_completed',
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
            total_amount: finalTotalPerItem,
            payment_session_id: sessionId,
            payment_method: 'paymongo',
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
        const adminMessage = `${paymentLabel} received via PayMongo. Items: ${notifiedItems.length}. Amount: ₱${Number(grandTotalPaid || amountPaid || 0).toLocaleString()}`;

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