import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const cancellableStatuses = new Set([
  'pending_payment',
  'reserved',
  'pending_balance_payment',
  'pending_acceptance',
]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_item_id, user_id, reason } = body || {};

    if (!user_item_id || !user_id) {
      return NextResponse.json({ error: 'Missing user_item_id or user_id' }, { status: 400 });
    }

    const { data: item, error: itemErr } = await supabase
      .from('user_items')
      .select('id, user_id, product_id, quantity, status, meta, reservation_fee')
      .eq('id', user_item_id)
      .single();

    if (itemErr || !item) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
    }

    if (item.user_id !== user_id) {
      return NextResponse.json({ error: 'Unauthorized access' }, { status: 403 });
    }

    if (!cancellableStatuses.has(item.status)) {
      return NextResponse.json({ error: 'Reservation can no longer be cancelled' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const meta = { ...(item.meta || {}) } as Record<string, any>;
    const reservationFee = Number(meta.reservation_fee ?? item.reservation_fee ?? 500);
    const inventoryReserved = Boolean(meta.inventory_reserved);

    let restoredInventory = false;

    if (inventoryReserved) {
      const { data: product } = await supabase
        .from('products')
        .select('inventory')
        .eq('id', item.product_id)
        .single();

      if (product) {
        const currentInventory = Number(product.inventory || 0);
        const updatedInventory = currentInventory + Number(item.quantity || 0);
        await supabase
          .from('products')
          .update({ inventory: updatedInventory })
          .eq('id', item.product_id);

        meta.product_stock_before = currentInventory;
        meta.product_stock_after = updatedInventory;
        restoredInventory = true;
      }

      meta.inventory_reserved = false;
      meta.inventory_restocked_at = now;
    }

    meta.user_cancelled_at = now;
    meta.user_cancellation_reason = reason || 'Cancelled by customer';
    meta.cancellation_state = 'user_cancelled';
    if (reservationFee) {
      meta.reservation_fee = reservationFee;
    }

    const { data: updatedItem, error: updateErr } = await supabase
      .from('user_items')
      .update({
        status: 'cancelled',
        order_status: 'cancelled',
        payment_status: meta.payment_status === 'completed' ? 'refund_pending' : meta.payment_status ?? 'pending',
        meta,
        updated_at: now,
      })
      .eq('id', user_item_id)
      .eq('user_id', user_id)
      .select('*')
      .single();

    if (updateErr) {
      console.error('❌ Failed to cancel reservation:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      item: updatedItem,
      inventoryRestored: restoredInventory,
    });
  } catch (error: any) {
    console.error('💥 Cancel reservation error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to cancel reservation' }, { status: 500 });
  }
}
