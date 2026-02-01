import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
      const isCartCheckout = meta?.is_cart_checkout === 'true';
      const cartItemIdsCsv = meta?.cart_item_ids || '';
      const userItemIdsCsv =
        meta?.user_item_ids ||
        session?.attributes?.metadata?.user_item_ids ||
        '';
      const ids: string[] = String(isCartCheckout ? cartItemIdsCsv : userItemIdsCsv)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);

      // Pull receipt context from metadata
      const subtotal = Number(meta?.subtotal || 0);
      const addonsTotal = Number(meta?.addons_total || 0);
      const discountValue = Number(meta?.discount_value || 0);
      const paymentType = meta?.payment_type || 'order';
      const reservationFee = Number(meta?.reservation_fee || (paymentType === 'reservation' ? 500 : 0));
      const totalAmount = Number(meta?.total_amount || amountPaid);

      console.log('🔍 Processing payment for items:', ids);
      console.log('🛒 Is cart checkout:', isCartCheckout);
      console.log('💰 Amount paid:', amountPaid, 'Total:', totalAmount);
      console.log('📦 Payment type:', paymentType);
      console.log('🎫 Reservation fee:', reservationFee);

      if (ids.length === 0) {
        console.error('❌ No item IDs in webhook data');
        return NextResponse.json({ error: 'Invalid webhook data' }, { status: 400 });
      }

      const notifiedItems: { id: string; product_id: string; quantity: number; total_paid: number; user_id?: string }[] = [];
      let grandTotalPaid = 0;
      let cartUserId: string | null = null;

      if (isCartCheckout) {
        // === CART CHECKOUT FLOW ===
        // Create new user_items from cart table
        console.log('🛒 Processing cart checkout...');
        
        for (const cartId of ids) {
          const { data: cartItem } = await supabase
            .from('cart')
            .select('user_id, product_id, quantity, meta')
            .eq('id', cartId)
            .single();

          if (!cartItem) {
            console.warn(`⚠️ Cart item ${cartId} not found`);
            continue;
          }

          if (!cartUserId) cartUserId = cartItem.user_id;

          const itemMeta = cartItem.meta || {};
          const finalTotalPerItem = Number(itemMeta.final_total_per_item || 0);
          const lineAfterDiscount = Number(itemMeta.line_total_after_discount || 0);
          const productPrice = Number(itemMeta.product_price || 0);
          const deliveryAddressId = itemMeta.delivery_address_id || null;
          const reservationShare = Number(itemMeta.reservation_fee_share || 0);
          const addonsPerItem = Number(itemMeta.addons_total_per_item || 0);

          grandTotalPaid += finalTotalPerItem;

          // Create new user_item from cart
          const { data: newUserItem, error: insertErr } = await supabase
            .from('user_items')
            .insert({
              user_id: cartItem.user_id,
              product_id: cartItem.product_id,
              item_type: 'reservation',
              status: 'pending_payment',
              order_status: 'pending_payment',
              quantity: cartItem.quantity,
              price: productPrice,
              total_paid: finalTotalPerItem,
              total_amount: lineAfterDiscount,
              reservation_fee: reservationFee,
              payment_status: 'completed',
              payment_id: sessionId,
              payment_method: 'paymongo',
              delivery_address_id: deliveryAddressId,
              meta: {
                ...itemMeta,
                payment_confirmed_at: new Date().toISOString(),
                amount_paid: finalTotalPerItem,
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
                from_cart: true,
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (insertErr) {
            console.error(`❌ Failed to create user_item from cart ${cartId}:`, insertErr);
            continue;
          }

          console.log(`✅ Created user_item ${newUserItem.id} from cart ${cartId}`);

          // Deduct inventory
          try {
            const { data: product, error: productErr } = await supabase
              .from('products')
              .select('inventory')
              .eq('id', cartItem.product_id)
              .single();

            if (product && !productErr) {
              const newInventory = Math.max(0, product.inventory - cartItem.quantity);
              const { error: inventoryErr } = await supabase
                .from('products')
                .update({ inventory: newInventory })
                .eq('id', cartItem.product_id);

              if (inventoryErr) {
                console.error(`❌ Failed to deduct inventory for product ${cartItem.product_id}:`, inventoryErr);
              } else {
                console.log(`✅ Deducted ${cartItem.quantity} from product ${cartItem.product_id} inventory (${product.inventory} → ${newInventory})`);
              }
            }
          } catch (invErr) {
            console.error(`❌ Inventory deduction error for product ${cartItem.product_id}:`, invErr);
          }

          notifiedItems.push({
            id: newUserItem.id,
            product_id: cartItem.product_id,
            quantity: cartItem.quantity,
            total_paid: finalTotalPerItem,
            user_id: cartItem.user_id,
          });
        }

        // Delete processed cart items
        if (ids.length > 0) {
          const { error: deleteErr } = await supabase
            .from('cart')
            .delete()
            .in('id', ids);

          if (deleteErr) {
            console.error('❌ Failed to delete cart items:', deleteErr);
          } else {
            console.log(`✅ Deleted ${ids.length} cart items`);
          }
        }
      } else {
        // === DIRECT RESERVATION FLOW ===
        // Update existing user_items
        console.log('📋 Processing direct reservation...');
        
        for (const id of ids) {
          const { data: userItem } = await supabase
            .from('user_items')
            .select('user_id, product_id, quantity, meta, reservation_fee, item_type, price, status')
            .eq('id', id)
            .single();

          if (!userItem) {
            console.warn(`⚠️ Item ${id} not found`);
            continue;
          }

          const isReservation = userItem.item_type === 'reservation';

          if (!isReservation) {
            console.warn(`⚠️ Item ${id} is not a reservation (type: ${userItem.item_type})`);
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
            price: Number(userItem.price || 0),
            payment_status: 'completed',
            payment_id: sessionId,
            total_paid: finalTotalPerItem,
            total_amount: lineAfterDiscount,
            reservation_fee: reservationFee,
            payment_method: 'paymongo',
            meta: {
              ...itemMeta,
              payment_confirmed_at: new Date().toISOString(),
              amount_paid: finalTotalPerItem,
              total_amount: lineAfterDiscount,
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

          const { error: updateErr } = await supabase
            .from('user_items')
            .update(updateData)
            .eq('id', id);

          if (updateErr) {
            console.error(`❌ Failed to update item ${id}:`, updateErr);
          } else {
            console.log(`✅ Updated reservation ${id} to pending_payment status`);

            // Deduct inventory from products table
            try {
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
      }

      // Send admin notification
      if (notifiedItems.length) {
        const paymentLabel = isCartCheckout ? 'Cart order payment' : 'Reservation payment';
        const notificationTitle = isCartCheckout ? 'Cart Order Paid' : 'Reservation Paid';
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
            is_cart_checkout: isCartCheckout,
            amount_paid: grandTotalPaid || amountPaid,
            subtotal,
            addons_total: addonsTotal,
            discount_value: discountValue,
            reservation_fee: reservationFee,
            user_item_ids: notifiedItems.map(i => i.id),
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
