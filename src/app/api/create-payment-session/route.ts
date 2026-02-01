import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
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

async function createPayMongoSession(sessionData: any) {
  const {
    amount,
    currency,
    user_item_ids,
    success_url,
    cancel_url,
    metadata = {},
    payment_type = 'order',
    lineItems = [],
  } = sessionData;

  const idsCsv = Array.isArray(user_item_ids) ? user_item_ids.join(',') : '';

  const checkoutData = {
    data: {
      attributes: {
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        line_items: lineItems,
        payment_method_types: ['gcash', 'paymaya'],
        success_url,
        cancel_url,
        description: `Payment for ${lineItems.length} item(s)`,
        metadata: {
          ...metadata,
          user_item_ids: idsCsv,
          payment_type,
        },
      },
    },
  };

  const response = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ':').toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(checkoutData)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`PayMongo API error: ${JSON.stringify(errorData)}`);
  }

  const result = await response.json();
  return {
    sessionId: result.data.id,
    checkoutUrl: result.data.attributes.checkout_url
  };
}

async function createPayPalOrder(orderData: any) {
  const {
    amount,
    user_item_ids,
    success_url,
    cancel_url,
    items = [],
  } = orderData;

  const accessToken = await getPayPalAccessToken();
  const idsCsv = Array.isArray(user_item_ids) ? user_item_ids.join(',') : '';
  const usdAmount = Number((Number(amount || 0) / 50).toFixed(2));

  const paypalOrderData = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: idsCsv || 'order',
        custom_id: idsCsv || 'order',
        description: `Payment for ${items.length} item(s)`,
        amount: {
          currency_code: 'USD',
          value: usdAmount.toFixed(2),
          breakdown: {
            item_total: { currency_code: 'USD', value: usdAmount.toFixed(2) }
          }
        },
        items: items.map((item: any) => ({
          name: item.name,
          quantity: String(item.quantity),
          unit_amount: { currency_code: 'USD', value: item.unit_amount }
        })),
      },
    ],
    application_context: {
      brand_name: 'GrandLink',
      landing_page: 'NO_PREFERENCE',
      user_action: 'PAY_NOW',
      return_url: success_url,
      cancel_url: cancel_url,
    },
  };

  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(paypalOrderData)
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`PayPal API error: ${errorData}`);
  }

  const result = await response.json();
  const approvalUrl = result.links?.find((link: any) => link.rel === 'approve')?.href;

  return {
    sessionId: result.id,
    checkoutUrl: approvalUrl
  };
}

function allocateCents(totalCents: number, weights: number[]): number[] {
  const normalizedWeights = weights.map((w) => Math.max(0, Math.floor(w)));
  const count = normalizedWeights.length;
  if (count === 0 || totalCents <= 0) {
    return weights.map(() => 0);
  }

  const weightSum = normalizedWeights.reduce((acc, val) => acc + val, 0);
  const allocations = new Array(count).fill(0);

  if (weightSum === 0) {
    const evenShare = Math.floor(totalCents / count);
    const remainder = totalCents - evenShare * count;
    for (let i = 0; i < count; i++) {
      allocations[i] = evenShare + (i === count - 1 ? remainder : 0);
    }
    return allocations;
  }

  let remaining = totalCents;
  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      allocations[i] += remaining;
      remaining = 0;
      break;
    }
    const share = Math.floor((normalizedWeights[i] * totalCents) / weightSum);
    const boundedShare = Math.min(share, remaining);
    allocations[i] += boundedShare;
    remaining -= boundedShare;
  }

  if (remaining > 0) {
    allocations[count - 1] += remaining;
  }

  return allocations;
}

export async function POST(request: NextRequest) {
  try {
    const {
      user_item_ids,
      cart_ids,
      user_id,
      payment_method = 'paymongo',
      payment_type = 'reservation',
      success_url,
      cancel_url,
      voucher,
      delivery_method,
      delivery_address_id,
      branch,
      receipt_ref,
    } = await request.json();

    if (!success_url || !cancel_url) {
      return NextResponse.json({ error: 'Missing required data' }, { status: 400 });
    }

    let rows: any[] = [];
    let createdUserItemIds: string[] = [];

    // Handle cart checkout (new flow)
    if (cart_ids && Array.isArray(cart_ids) && cart_ids.length > 0) {
      if (!user_id) {
        return NextResponse.json({ error: 'user_id required for cart checkout' }, { status: 400 });
      }

      // Load cart items
      const { data: cartItems, error: cartErr } = await supabase
        .from('cart')
        .select('id, product_id, quantity, meta')
        .eq('user_id', user_id)
        .in('id', cart_ids);

      if (cartErr || !cartItems || cartItems.length === 0) {
        return NextResponse.json({ error: 'Cart items not found' }, { status: 404 });
      }

      // Create user_items from cart
      const nowIso = new Date().toISOString();
      const userItemsToInsert = cartItems.map((cartItem: any) => ({
        user_id,
        product_id: cartItem.product_id,
        item_type: 'reservation',
        status: 'pending_payment',
        order_status: 'pending_payment',
        quantity: cartItem.quantity,
        meta: {
          ...(cartItem.meta || {}),
          ...(delivery_method ? { delivery_method } : {}),
          branch,
          from_cart: true,
          cart_id: cartItem.id,
          ...(receipt_ref ? { receipt_ref } : {}),
        },
        delivery_address_id,
        created_at: nowIso,
        updated_at: nowIso,
      }));

      const { data: created, error: insertErr } = await supabase
        .from('user_items')
        .insert(userItemsToInsert)
        .select('id, quantity, meta, product_id');

      if (insertErr || !created) {
        console.error('Failed to create user_items from cart:', insertErr);
        return NextResponse.json({ error: 'Failed to create reservation items' }, { status: 500 });
      }

      rows = created;
      createdUserItemIds = created.map((r: any) => r.id);

    } else if (user_item_ids && Array.isArray(user_item_ids) && user_item_ids.length > 0) {
      // Handle direct reservation (existing flow)
      const { data: existingItems, error: itemsErr } = await supabase
        .from('user_items')
        .select('id, quantity, meta, product_id, item_type')
        .in('id', user_item_ids);

      if (itemsErr || !existingItems || existingItems.length === 0) {
        return NextResponse.json({ error: 'Items not found' }, { status: 404 });
      }

      // Validate that all items are reservations
      const validTypes = existingItems.every(r => r.item_type === 'reservation');
      if (!validTypes) {
        return NextResponse.json({ error: 'Invalid item types for payment' }, { status: 400 });
      }

      rows = existingItems;
      createdUserItemIds = user_item_ids;
    } else {
      return NextResponse.json({ error: 'Either cart_ids or user_item_ids required' }, { status: 400 });
    }

    const productIds = Array.from(new Set(rows.map((r) => r.product_id)));
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, name, price, inventory')
      .in('id', productIds);

    if (prodErr) {
      return NextResponse.json({ error: 'Products fetch failed' }, { status: 500 });
    }

    const productMap = new Map((products || []).map((p) => [p.id, p]));

    // Reserve inventory immediately for reservations so UI reflects stock change
    // and avoid double-deduct later by marking inventory_deducted in meta
    if (payment_type === 'reservation') {
      for (const r of rows) {
        const p = productMap.get(r.product_id);
        const qty = Math.max(1, Number(r.quantity || 1));
        const meta = r.meta || {};
        // Skip if already reserved/deducted (idempotency)
        if (meta.inventory_reserved || meta.inventory_deducted) continue;
        if (!p) {
          return NextResponse.json({ error: `Product not found for reservation` }, { status: 404 });
        }
        const currentInv = Number(p.inventory ?? 0);
        const nextInv = currentInv - qty;
        if (nextInv < 0) {
          return NextResponse.json({ error: `Insufficient inventory for ${p.name}` }, { status: 409 });
        }
        // Persist inventory deduction
        const { error: invErr } = await supabase
          .from('products')
          .update({ inventory: nextInv })
          .eq('id', r.product_id);
        if (invErr) {
          return NextResponse.json({ error: `Failed to reserve inventory: ${invErr.message}` }, { status: 500 });
        }
        // Mark user_item so webhooks/capture won't deduct again
        const reservedMeta = {
          ...meta,
          inventory_reserved: true,
          inventory_deducted: true,
          product_stock_before: currentInv,
          product_stock_after: nextInv,
          inventory_reserved_at: new Date().toISOString(),
        };
        await supabase
          .from('user_items')
          .update({ meta: reservedMeta })
          .eq('id', r.id);
        // Update our local productMap to reflect new inventory for subsequent items
        p.inventory = nextInv;
      }
    }
    let subtotal = 0;
    let addonsTotal = 0;

    const itemDetails = rows.map((r) => {
      const p = productMap.get(r.product_id);
      const unit = Number(p?.price || 0);
      const qty = Math.max(1, Number(r.quantity || 1));
      const addons: any[] = Array.isArray(r.meta?.addons) ? r.meta.addons : [];
      const addonTotal = addons.reduce((sum: number, addon: any) => sum + Number(addon?.fee || 0), 0);
      const lineSubtotal = unit * qty;
      subtotal += lineSubtotal;
      addonsTotal += addonTotal;

      const lineSubtotalCents = Math.round(lineSubtotal * 100);
      const addonsCents = Math.round(addonTotal * 100);

      return {
        id: r.id,
        name: p?.name || 'Product',
        qty,
        unit,
        lineSubtotal,
        lineSubtotalCents,
        addonTotal,
        addonTotalCents: addonsCents,
        addons,
      };
    });

    let preDiscount = subtotal + addonsTotal;
    let appliedDiscount = 0;
    
    if (voucher?.type === 'percent') {
      appliedDiscount = preDiscount * (Number(voucher.value || 0) / 100);
    } else if (voucher?.type === 'amount') {
      appliedDiscount = Number(voucher.value || 0);
    }
    appliedDiscount = Math.min(appliedDiscount, preDiscount);
    
    const lineTotalsCents = itemDetails.map((item) => item.lineSubtotalCents + item.addonTotalCents);
    const totalLineCents = lineTotalsCents.reduce((acc, cents) => acc + cents, 0);
    const appliedDiscountCents = Math.round(appliedDiscount * 100);
    const discountAllocations = allocateCents(appliedDiscountCents, lineTotalsCents);
    const netLineCents = lineTotalsCents.map((gross, idx) => Math.max(0, gross - (discountAllocations[idx] || 0)));

    const payMongoLineItems: any[] = [];
    const displayLineItems: any[] = [];
    let netProductTotalCents = 0;

    itemDetails.forEach((item, idx) => {
      const grossCents = lineTotalsCents[idx] || 0;
      const discountCents = discountAllocations[idx] || 0;
      const netCents = netLineCents[idx] || 0;
      netProductTotalCents += netCents;

      const unitNetCents = item.qty > 0 ? Math.round(netCents / item.qty) : netCents;
      const unitNetPrice = unitNetCents / 100;

      const descriptionParts: string[] = [];
      descriptionParts.push(`Unit price after discount: ₱${unitNetPrice.toFixed(2)}`);
      if (item.addonTotal > 0) {
        descriptionParts.push(`Add-ons: ₱${item.addonTotal.toFixed(2)} (${item.addons.map((a: any) => a?.label || a?.key).join(', ')})`);
      }
      if (discountCents > 0) {
        descriptionParts.push(`Total discount: -₱${(discountCents / 100).toFixed(2)}`);
      }

      payMongoLineItems.push({
        name: item.addonTotal > 0 ? `${item.name} (+addons)` : item.name,
        quantity: item.qty,
        amount: unitNetCents,
        currency: 'PHP',
        description: descriptionParts.join(' | ')
      });

      displayLineItems.push({
        type: 'product',
        name: item.name,
        quantity: item.qty,
        base_amount: Number((grossCents / 100).toFixed(2)),
        discount_value: Number((discountCents / 100).toFixed(2)),
        addons_total: Number(item.addonTotal.toFixed(2)),
        line_total: Number((netCents / 100).toFixed(2))
      });
    });

    // Reservation Fee is ALWAYS ₱500 (fixed, no adjustments)
    const reservationFeeBase = 500;
    const reservationFeeCents = 50000; // ₱500.00 in centavos

    const reservationWeights = netLineCents.some((c) => c > 0) ? netLineCents : lineTotalsCents;
    const reservationAllocations = allocateCents(reservationFeeCents, reservationWeights);

    const reservationLineItem = {
      name: 'Reservation Fee',
      quantity: 1,
      amount: reservationFeeCents,
      currency: 'PHP',
      description: 'One-time reservation fee (non-discountable)'
    };
    payMongoLineItems.push(reservationLineItem);
    displayLineItems.push({
      type: 'reservation_fee',
      name: 'Reservation Fee',
      quantity: 1,
      unit_price: 500,
      line_total: 500
    });

    // Final total = products (after discount) + reservation fee
    const finalTotalCents = netProductTotalCents + reservationFeeCents;

    if (appliedDiscountCents > 0) {
      const discountLabel = voucher?.code ? `Discount (${voucher.code})` : 'Discount';
      const discountCurrencyDisplay = (appliedDiscountCents / 100).toFixed(2);
      payMongoLineItems.push({
        name: `${discountLabel} -₱${discountCurrencyDisplay}`,
        quantity: 1,
        amount: 0,
        currency: 'PHP',
        description: `Discount applied: -₱${discountCurrencyDisplay}`
      });
      displayLineItems.push({
        type: 'discount',
        name: `${discountLabel} -₱${discountCurrencyDisplay}`,
        quantity: 1,
        unit_price: -Number((appliedDiscountCents / 100).toFixed(2)),
        line_total: -Number((appliedDiscountCents / 100).toFixed(2))
      });
    }

    const reservationFeeCharged = reservationFeeCents / 100;
    const totalAmount = Number((finalTotalCents / 100).toFixed(2));

    const payPalItems: any[] = [];
    itemDetails.forEach((item, idx) => {
      const netValuePhp = Math.max(0, (netLineCents[idx] || 0) / 100);
      const unitNetValuePhp = item.qty > 0 ? netValuePhp / item.qty : netValuePhp;
      const usdUnit = Number((unitNetValuePhp / 50).toFixed(2));

      payPalItems.push({
        name: item.addonTotal > 0 ? `${item.name} (+addons)` : item.name,
        quantity: String(item.qty),
        unit_amount: usdUnit.toFixed(2)
      });
    });

    const reservationFeeUsd = Number((reservationFeeCharged / 50).toFixed(2));
    payPalItems.push({
      name: 'Reservation Fee',
      quantity: 1,
      unit_amount: reservationFeeUsd.toFixed(2)
    });

    const itemMetaMap = new Map<string, {
      lineDiscountValue: number;
      lineTotalAfterDiscount: number;
      reservationShare: number;
      finalTotal: number;
      addonsTotal: number;
    }>();
    itemDetails.forEach((item, idx) => {
      const discountValue = (discountAllocations[idx] || 0) / 100;
      const netLineTotal = Math.max(0, (netLineCents[idx] || 0) / 100);
      const reservationShare = (reservationAllocations[idx] || 0) / 100;
      const finalTotal = netLineTotal + reservationShare;
      itemMetaMap.set(item.id, {
        lineDiscountValue: Number(discountValue.toFixed(2)),
        lineTotalAfterDiscount: Number(netLineTotal.toFixed(2)),
        reservationShare: Number(reservationShare.toFixed(2)),
        finalTotal: Number(finalTotal.toFixed(2)),
        addonsTotal: Number(item.addonTotal.toFixed(2)),
      });
    });

    // Update meta for all items (they stay as cart items until payment succeeds)
    for (const r of rows) {
      const item = itemDetails.find(i => i.id === r.id)!;
      const metaInfo = itemMetaMap.get(item.id) || {
        lineDiscountValue: 0,
        lineTotalAfterDiscount: 0,
        reservationShare: 0,
        finalTotal: 0,
        addonsTotal: 0,
      };
      const product = productMap.get(r.product_id);
      await supabase
        .from('user_items')
        .update({
          price: Number(product?.price || 0),
          // Prefill per-item final total so UI can reflect the PayMongo/PayPal amount immediately
          total_amount: metaInfo.finalTotal,
          meta: {
            ...(r.meta || {}),
            product_name: product?.name || 'Product',
            voucher_code: voucher?.code || null,
            discount_value: appliedDiscount,
            line_discount_value: metaInfo.lineDiscountValue,
            subtotal,
            addons_total: addonsTotal,
            total_amount: totalAmount,
            reservation_fee: reservationFeeCharged,
            reservation_fee_base: reservationFeeBase,
            line_total_after_discount: metaInfo.lineTotalAfterDiscount,
            reservation_fee_share: metaInfo.reservationShare,
            final_total_per_item: metaInfo.finalTotal,
            addons_total_per_item: metaInfo.addonsTotal,
            payment_type,
            ...(receipt_ref ? { receipt_ref } : {}),
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', r.id);
    }

    const perItemSummary = itemDetails.map((item, idx) => ({
      id: item.id,
      quantity: item.qty,
      gross_total: Number((lineTotalsCents[idx] / 100).toFixed(2)),
      discount_value: Number((discountAllocations[idx] / 100).toFixed(2)),
      net_total: Number((netLineCents[idx] / 100).toFixed(2)),
      reservation_fee_share: Number(((reservationAllocations[idx] || 0) / 100).toFixed(2)),
      final_total: Number(((netLineCents[idx] + (reservationAllocations[idx] || 0)) / 100).toFixed(2)),
      addons_total: Number(item.addonTotal.toFixed(2)),
    }));

    const baseMetadata = {
      user_item_ids: createdUserItemIds.join(','),
      cart_ids: cart_ids ? cart_ids.join(',') : undefined,
      subtotal,
      addons_total: addonsTotal,
      discount_code: voucher?.code || null,
      discount_value: appliedDiscount,
      payment_type,
      reservation_fee: reservationFeeCharged,
      reservation_fee_base: reservationFeeBase,
      total_amount: totalAmount,
      line_items_json: JSON.stringify(displayLineItems),
      per_item_summary_json: JSON.stringify(perItemSummary),
      ...(receipt_ref ? { receipt_ref } : {}),
    };

    let sessionId: string;
    let checkoutUrl: string;

    if (payment_method === 'paypal') {
      const res = await createPayPalOrder({
        amount: totalAmount,
        user_item_ids: createdUserItemIds,
        success_url,
        cancel_url,
        items: payPalItems,
      });
      sessionId = res.sessionId;
      checkoutUrl = res.checkoutUrl;
    } else {
      const res = await createPayMongoSession({
        amount: totalAmount,
        currency: 'PHP',
        user_item_ids: createdUserItemIds,
        success_url,
        cancel_url,
        payment_type,
        metadata: baseMetadata,
        lineItems: payMongoLineItems,
      });
      sessionId = res.sessionId;
      checkoutUrl = res.checkoutUrl;
    }

    return NextResponse.json({ sessionId, checkoutUrl, success: true });
  } catch (error: any) {
    console.error('Payment session creation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create payment session' },
      { status: 500 }
    );
  }
}