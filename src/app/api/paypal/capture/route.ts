import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureInvoiceForUserItem } from '@/app/lib/invoiceService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_ENVIRONMENT =
  process.env.PAYPAL_ENVIRONMENT ||
  (process.env.NODE_ENV === 'production' ? 'live' : 'sandbox');
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

export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json();

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID required' }, { status: 400 });
    }

    // Get access token
    const accessToken = await getPayPalAccessToken();

    // Capture the order
    const captureResponse = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!captureResponse.ok) {
      const errorData = await captureResponse.text();
      console.error('PayPal capture failed:', errorData);
      return NextResponse.json({ error: 'Payment capture failed' }, { status: 500 });
    }

    const captureData = await captureResponse.json();
    
    // Process the successful payment (similar to webhook logic)
    const userItemIdsCsv = captureData.purchase_units?.[0]?.custom_id || captureData.purchase_units?.[0]?.reference_id;
    const userItemIds: string[] = String(userItemIdsCsv || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (userItemIds.length > 0) {
      // Update payment session
      await supabase
        .from('payment_sessions')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('stripe_session_id', orderId);

      for (const userItemId of userItemIds) {
        const { data: userItem, error: fetchError } = await supabase
          .from('user_items')
          .select('id, product_id, quantity, meta, price')
          .eq('id', userItemId)
          .single();

        if (fetchError || !userItem) continue;

        const itemMeta = userItem.meta || {};
        const lineAfterDiscount = Number(itemMeta.line_total_after_discount ?? itemMeta.line_total ?? 0);
        const reservationShare = Number(itemMeta.reservation_fee_share ?? 0);
        const fallbackTotal = lineAfterDiscount + reservationShare;
        const totalAmount = Number((((itemMeta.final_total_per_item ?? fallbackTotal) as number) || 0).toFixed(2));

        await supabase
          .from('user_items')
          .update({
            status: 'pending_payment',
            order_status: 'pending_payment',
            payment_status: 'completed',
            payment_id: orderId,
            total_paid: totalAmount,
            total_amount: totalAmount,
            payment_method: 'paypal',
            meta: {
              ...itemMeta,
              payment_confirmed_at: new Date().toISOString(),
              payment_method: 'paypal',
              paypal_order_id: orderId
            }
          })
          .eq('id', userItemId);

        const alreadyDeducted = Boolean(itemMeta?.inventory_deducted);
        if (!alreadyDeducted) {
          const { data: product } = await supabase
            .from('products')
            .select('inventory')
            .eq('id', userItem.product_id)
            .single();

          if (product) {
            const newInventory = Math.max(0, (product.inventory || 0) - userItem.quantity);
            await supabase
              .from('products')
              .update({ inventory: newInventory })
              .eq('id', userItem.product_id);
            await supabase
              .from('user_items')
              .update({
                meta: {
                  ...itemMeta,
                  inventory_deducted: true,
                  product_stock_before: product.inventory,
                  product_stock_after: newInventory,
                },
              })
              .eq('id', userItemId);
          }
        }

        try {
          await ensureInvoiceForUserItem(userItemId);
          console.log(`✅ Invoice ensured and email attempt done for item ${userItemId}`);
        } catch (invoiceErr) {
          console.warn(`⚠️ Failed to ensure invoice for item ${userItemId}:`, invoiceErr);
        }
      }
    }

    return NextResponse.json({ 
      success: true,
      captureData,
      userItemIds 
    });

  } catch (error: any) {
    console.error('PayPal capture error:', error);
    return NextResponse.json(
      { error: error.message || 'Payment processing failed' },
      { status: 500 }
    );
  }
}