import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeMeasurementPricing } from '../../../utils/measurementPricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PayRex SDK (no types shipped; use require to avoid TS module-declaration errors under strict mode)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const payrexNode = require('payrex-node');

const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYREX_SECRET_KEY = process.env.PAYREX_SECRET_KEY;
const PAYREX_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_PAYREX_PUBLIC_KEY ||
  process.env.NEXT_PUBLIC_PAYREX_PUBLIX_KEY ||
  process.env.PUBLIC_PAYREX_PUBLIX_KEY ||
  process.env.PAYREX_PUBLIC_KEY;
const PAYREX_PAYMENT_METHODS = process.env.PAYREX_PAYMENT_METHODS;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_ENVIRONMENT = process.env.PAYPAL_ENVIRONMENT || 'sandbox';
const PAYPAL_BASE_URL = PAYPAL_ENVIRONMENT === 'sandbox' 
  ? 'https://api-m.sandbox.paypal.com' 
  : 'https://api-m.paypal.com';

let payrexClient: any | null = null;
function getPayrexClient() {
  const keyToUse = PAYREX_SECRET_KEY || PAYREX_PUBLIC_KEY;
  if (!keyToUse) {
    throw new Error('PAYREX_SECRET_KEY (or NEXT_PUBLIC_PAYREX_PUBLIC_KEY) is not set on the server');
  }
  if (!payrexClient) {
    payrexClient = payrexNode(keyToUse);
  }
  return payrexClient;
}

function getRequestOrigin(request: NextRequest) {
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host) {
    return `${proto || 'https'}://${host}`;
  }
  return new URL(request.url).origin;
}

function toAbsoluteUrl(urlLike: unknown, origin: string): string | null {
  if (typeof urlLike !== 'string' || !urlLike.trim()) return null;
  try {
    return new URL(urlLike, origin).toString();
  } catch {
    return null;
  }
}

function sanitizePayRexMetadata(input: Record<string, unknown>) {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) output[key] = trimmed.slice(0, 240);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      output[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      output[key] = value;
      continue;
    }
    output[key] = String(value).slice(0, 240);
  }
  return output;
}

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

  if (!PAYMONGO_SECRET_KEY) {
    throw new Error('PAYMONGO_SECRET_KEY is not set on the server');
  }

  const configuredMethodTypes = (process.env.PAYMONGO_PAYMENT_METHOD_TYPES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // PayMongo uses the same API host for test and live; mode is determined by the API key.
  // We default to requesting GCash, Maya, and Card in BOTH modes.
  // If your PayMongo account doesn't have a method enabled, PayMongo's hosted checkout can
  // show "No payment methods are available" — in that case, enable the methods in your
  // PayMongo dashboard or temporarily force method types via PAYMONGO_PAYMENT_METHOD_TYPES.
  const paymentMethodTypes = configuredMethodTypes.length
    ? configuredMethodTypes
    : ['gcash', 'paymaya', 'card'];

  // Ensure we always request at least one known method.
  if (paymentMethodTypes.length === 0) {
    paymentMethodTypes.push('card');
  }

  const idsCsv = Array.isArray(user_item_ids) ? user_item_ids.join(',') : '';

  const checkoutData = {
    data: {
      attributes: {
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        line_items: lineItems,
        payment_method_types: paymentMethodTypes,
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

async function createPayRexCheckoutSession(sessionData: any) {
  const {
    user_item_ids,
    success_url,
    cancel_url,
    metadata = {},
    payment_type = 'order',
    lineItems = [],
    billing,
    customer,
  } = sessionData;

  const payrex = getPayrexClient();

  const configuredMethods = (PAYREX_PAYMENT_METHODS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Business requirement: do NOT show Credit/Debit Card on checkout.
  // Force-remove card methods even if configured in env.
  const paymentMethods = (configuredMethods.length
    ? configuredMethods
    : ['gcash', 'maya']
  ).filter((m) => !['card', 'credit', 'debit', 'credit_card', 'debit_card'].includes(m));

  if (paymentMethods.length === 0) {
    paymentMethods.push('gcash');
  }

  const idsCsv = Array.isArray(user_item_ids) ? user_item_ids.join(',') : '';

  const rawLineItems = (Array.isArray(lineItems) ? lineItems : [])
    .filter((li) => li && typeof li === 'object')
    .map((li: any) => {
      const image = Array.isArray(li.images) && li.images.length > 0 ? li.images[0] : li.image;
      const normalized: any = {
        name: li.name,
        quantity: Number(li.quantity),
        amount: Number(li.amount),
      };
      if (typeof image === 'string' && /^https?:\/\//i.test(image)) {
        normalized.image = image;
      }
      return normalized;
    })
    .filter((li: any) =>
      typeof li.name === 'string' &&
      li.name.trim().length > 0 &&
      Number.isFinite(li.quantity) &&
      li.quantity > 0 &&
      Number.isFinite(li.amount) &&
      li.amount > 0
    );

  const basePayload: any = {
    currency: 'PHP',
    success_url,
    cancel_url,
    payment_methods: paymentMethods,
    customer_reference_id: idsCsv || undefined,
    description: `Payment for ${rawLineItems.length} item(s)`,
    metadata: {
      ...metadata,
      user_item_ids: idsCsv,
      payment_type,
    },
  };

  // Best-effort: if the website already has an address on file, pass it to PayRex
  // so the user does not need to re-enter address fields in the hosted checkout.
  // We intentionally do NOT rely on website-provided email/phone for invoicing.
  if (billing && typeof billing === 'object') {
    basePayload.billing = billing;
  }
  if (customer && typeof customer === 'object') {
    basePayload.customer = customer;
  }

  if (rawLineItems.length === 0) {
    throw new Error('No valid line items to send to PayRex');
  }

  const payload: any = {
    ...basePayload,
    // Business requirement: do NOT prompt for address/phone fields in the hosted PayRex checkout.
    // The website already has a saved default/selected address; we prefill it server-side.
    // Keep only Name + Email for the user to confirm/edit.
    // If PayRex doesn't support these flags, we safely retry without them.
    billing_details_collection: 'auto',
    billing_address_collection: 'never',
    // PayRex requires line_items[*][amount] (integer in centavos).
    line_items: rawLineItems.map((li: any) => ({
      name: li.name,
      amount: Math.round(li.amount),
      quantity: Math.round(li.quantity),
      ...(li.image ? { image: li.image } : {}),
    })),
  };

  payload.metadata = sanitizePayRexMetadata(payload.metadata || {});

  try {
    const checkoutSession = await payrex.checkoutSessions.create(payload);
    return {
      sessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
    };
  } catch (err: any) {
    if (err?.name === 'RequestInvalidError') {
      console.error('❌ PayRex RequestInvalidError:', JSON.stringify(err?.errors || [], null, 2));

      // If PayRex doesn't accept billing_details_collection (older API versions), retry without it.
      // Also: if PayRex rejects optional prefill fields, retry without them to avoid checkout failures.
      const errors: any[] = Array.isArray(err?.errors) ? err.errors : [];
      const billingCollectionRejected = errors.some((e) =>
        typeof e?.parameter === 'string' && e.parameter.includes('billing_details_collection')
      );

      const billingAddressCollectionRejected = errors.some((e) =>
        typeof e?.parameter === 'string' && e.parameter.includes('billing_address_collection')
      );

      const billingRejected = errors.some((e) => typeof e?.parameter === 'string' && e.parameter.startsWith('billing'));
      const customerRejected = errors.some((e) => typeof e?.parameter === 'string' && e.parameter.startsWith('customer'));

      if (billingCollectionRejected || billingAddressCollectionRejected || billingRejected || customerRejected) {
        const retryPayload = { ...payload } as any;
        if (billingCollectionRejected) delete retryPayload.billing_details_collection;
        if (billingAddressCollectionRejected) delete retryPayload.billing_address_collection;
        if (billingRejected) delete retryPayload.billing;
        if (customerRejected) delete retryPayload.customer;
        const checkoutSession = await payrex.checkoutSessions.create(retryPayload);
        return {
          sessionId: checkoutSession.id,
          checkoutUrl: checkoutSession.url,
        };
      }
    }
    throw err;
  }

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
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set on the server');
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set on the server');
    }

    const {
      user_item_ids,
      cart_ids,
      user_id,
      payment_method = 'payrex',
      payment_type = 'reservation',
      success_url,
      cancel_url,
      voucher,
      delivery_method,
      delivery_address_id,
      branch,
      receipt_ref,
    } = await request.json();

    const requestOrigin = getRequestOrigin(request);
    const resolvedSuccessUrl = toAbsoluteUrl(success_url, requestOrigin);
    const resolvedCancelUrl = toAbsoluteUrl(cancel_url, requestOrigin);

    if (!resolvedSuccessUrl || !resolvedCancelUrl) {
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
        .select('id, user_id, quantity, meta, product_id, delivery_address_id');

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
        .select('id, user_id, quantity, meta, product_id, item_type, delivery_address_id')
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
      .select('id, name, price, inventory, width, height, images, image1, image2')
      .in('id', productIds);

    if (prodErr) {
      return NextResponse.json({ error: 'Products fetch failed' }, { status: 500 });
    }

    const productMap = new Map((products || []).map((p) => [p.id, p]));

    const computeUnitPriceFromDimensions = (p: any, meta: any) => {
      const unitPricePerSqm = Number(p?.price || 0);

      const baseWmm = Number(p?.width || 0);
      const baseHmm = Number(p?.height || 0);
      const baseWidthM = Number.isFinite(baseWmm) && baseWmm > 0 ? baseWmm / 1000 : undefined;
      const baseHeightM = Number.isFinite(baseHmm) && baseHmm > 0 ? baseHmm / 1000 : undefined;

      const customWidth = meta?.custom_dimensions?.width;
      const customHeight = meta?.custom_dimensions?.height;
      const widthMeters = customWidth ?? baseWidthM;
      const heightMeters = customHeight ?? baseHeightM;

      const perPanelPrice = meta?.custom_dimensions?.per_panel_price ?? meta?.pricing?.per_panel_price;
      const addedPanels = meta?.custom_dimensions?.added_panels ?? meta?.pricing?.added_panels;

      return computeMeasurementPricing({
        widthMeters,
        heightMeters,
        unitPricePerSqm,
        minSqm: 1,
        sqmDecimals: 2,
        perPanelPrice,
        addedPanels,
      });
    };

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
      const pricing = computeUnitPriceFromDimensions(p, r.meta);
      const unit = pricing.unit_price;
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
        productId: r.product_id,
        name: p?.name || 'Product',
        qty,
        unit,
        unitBase: Number(p?.price || 0),
        pricing,
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

      // Avoid sending 0-amount line items to PayMongo (can lead to checkout showing no methods).
      if (unitNetCents > 0) {
        const p: any = item.productId ? productMap.get(item.productId) : null;
        const imgUrl: string | undefined =
          (Array.isArray(p?.images) && p.images[0]) || p?.image1 || p?.image2 || undefined;
        const images = imgUrl && typeof imgUrl === 'string' && /^https?:\/\//i.test(imgUrl) ? [imgUrl] : undefined;

        payMongoLineItems.push({
          name: item.addonTotal > 0 ? `${item.name} (+addons)` : item.name,
          quantity: item.qty,
          amount: unitNetCents,
          currency: 'PHP',
          description: descriptionParts.join(' | '),
          ...(images ? { images } : {}),
        });
      }

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
      // Keep discount only for our internal display metadata.
      // Do NOT send a 0-amount discount line item to PayMongo.
      const discountLabel = voucher?.code ? `Discount (${voucher.code})` : 'Discount';
      const discountCurrencyDisplay = (appliedDiscountCents / 100).toFixed(2);
      displayLineItems.push({
        type: 'discount',
        name: `${discountLabel} -₱${discountCurrencyDisplay}`,
        quantity: 1,
        unit_price: -Number((appliedDiscountCents / 100).toFixed(2)),
        line_total: -Number((appliedDiscountCents / 100).toFixed(2)),
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

    // Best-effort: attach customer contact details (from selected/default Delivery Address + auth user)
    // so invoice + provider checkout can prefill these fields and avoid prompting for address fields.
    const primaryUserId: string | null = (user_id as string | undefined) || (rows?.[0]?.user_id as string | undefined) || null;
    let primaryAddressId: string | null =
      (delivery_address_id as string | undefined) || (rows?.[0]?.delivery_address_id as string | undefined) || null;

    // If caller didn't supply an address id, fall back to the user's default saved address.
    if (!primaryAddressId && primaryUserId) {
      const { data: defaultAddr } = await supabase
        .from('addresses')
        .select('id')
        .eq('user_id', primaryUserId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (defaultAddr?.id) primaryAddressId = defaultAddr.id as string;
    }

    let customerName: string | null = null;
    let customerPhone: string | null = null;
    let customerEmail: string | null = null;
    let customerAddressLine1: string | null = null;

    if (primaryAddressId && (!customerName || !customerPhone || !customerEmail)) {
      const { data: addr } = await supabase
        .from('addresses')
        .select('full_name, first_name, last_name, phone, email, address')
        .eq('id', primaryAddressId)
        .maybeSingle();

      if (addr) {
        const name =
          (typeof (addr as any).full_name === 'string' && (addr as any).full_name.trim()) ||
          [
            typeof (addr as any).first_name === 'string' ? (addr as any).first_name.trim() : '',
            typeof (addr as any).last_name === 'string' ? (addr as any).last_name.trim() : '',
          ]
            .filter(Boolean)
            .join(' ');

        if (!customerName) customerName = name || null;
        if (!customerPhone) {
          customerPhone = typeof (addr as any).phone === 'string' && (addr as any).phone.trim() ? (addr as any).phone.trim() : null;
        }
        if (!customerEmail) {
          customerEmail = typeof (addr as any).email === 'string' && (addr as any).email.trim() ? (addr as any).email.trim() : null;
        }
        if (!customerAddressLine1) {
          customerAddressLine1 = typeof (addr as any).address === 'string' && (addr as any).address.trim() ? (addr as any).address.trim() : null;
        }
      }
    }

    if (primaryUserId && !customerEmail) {
      try {
        const { data: userWrap } = await supabase.auth.admin.getUserById(primaryUserId);
        const authEmail = userWrap?.user?.email;
        if (typeof authEmail === 'string' && authEmail.trim()) {
          customerEmail = authEmail.trim();
        }
      } catch (e) {
        // ignore; invoices will still work if we have address email
      }
    }

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
          price: Number(item.unit || 0),
          // Prefill per-item final total so UI can reflect the PayMongo/PayPal amount immediately
          total_amount: metaInfo.finalTotal,
          meta: {
            ...(r.meta || {}),
            ...(customerName ? { customer_name: customerName } : {}),
            ...(customerPhone ? { customer_phone: customerPhone } : {}),
            ...(customerEmail ? { customer_email: customerEmail } : {}),
            product_name: product?.name || 'Product',
            pricing: {
              ...(r.meta?.pricing || {}),
              unit_price: Number(item.unit || 0),
              unit_price_per_sqm: Number(product?.price || 0),
              sqm_raw: item.pricing?.sqm_raw,
              sqm_rounded: item.pricing?.sqm_rounded,
              sqm_billable: item.pricing?.sqm_billable,
              per_panel_price: item.pricing?.per_panel_price,
              added_panels: item.pricing?.added_panels,
              base_width_mm: (product as any)?.width,
              base_height_mm: (product as any)?.height,
              custom_width_m: item.pricing?.width_m,
              custom_height_m: item.pricing?.height_m,
            },
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

    const baseMetadata = {
      user_item_ids: createdUserItemIds.join(','),
      cart_ids: cart_ids ? cart_ids.join(',') : undefined,
      subtotal,
      addons_total: addonsTotal,
      // PayRex rejects blank/null values for metadata[discount_code]. Keep it always non-blank.
      discount_code: typeof voucher?.code === 'string' && voucher.code.trim().length > 0 ? voucher.code.trim() : 'none',
      discount_value: appliedDiscount,
      payment_type,
      reservation_fee: reservationFeeCharged,
      reservation_fee_base: reservationFeeBase,
      total_amount: totalAmount,
      ...(customerName ? { customer_name: customerName } : {}),
      ...(customerPhone ? { customer_phone: customerPhone } : {}),
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      ...(receipt_ref ? { receipt_ref } : {}),
    };

    let sessionId: string;
    let checkoutUrl: string;

    if (payment_method === 'paypal') {
      const res = await createPayPalOrder({
        amount: totalAmount,
        user_item_ids: createdUserItemIds,
        success_url: resolvedSuccessUrl,
        cancel_url: resolvedCancelUrl,
        items: payPalItems,
      });
      sessionId = res.sessionId;
      checkoutUrl = res.checkoutUrl;
    } else {
      // Backward compatibility: if the client still sends "paymongo", treat it as PayRex.
      // The project no longer uses PayMongo for checkout session creation.
      const normalizedMethod = payment_method === 'paymongo' ? 'payrex' : payment_method;
      if (normalizedMethod !== 'payrex') {
        return NextResponse.json({ error: 'Unsupported payment method' }, { status: 400 });
      }

      if (!PAYREX_SECRET_KEY) {
        throw new Error(
          'PAYREX_SECRET_KEY is not set on the server. Add it in Vercel Project Settings → Environment Variables (Production), then redeploy.'
        );
      }

      const res = await createPayRexCheckoutSession({
        user_item_ids: createdUserItemIds,
        success_url: resolvedSuccessUrl,
        cancel_url: resolvedCancelUrl,
        payment_type,
        metadata: baseMetadata,
        lineItems: payMongoLineItems,
        // Prefill from user's selected/default address so PayRex doesn't ask for address fields.
        ...(customerAddressLine1
          ? {
              billing: {
                address: {
                  line1: customerAddressLine1,
                  country: 'PH',
                },
              },
            }
          : {}),
        // Prefill name/email. Do not pass phone so checkout won't prompt for it.
        ...(customerName || customerEmail
          ? {
              customer: {
                ...(customerName ? { name: customerName } : {}),
                ...(customerEmail ? { email: customerEmail } : {}),
              },
            }
          : {}),
      });
      sessionId = res.sessionId;
      checkoutUrl = res.checkoutUrl;
    }

    return NextResponse.json({ sessionId, checkoutUrl, success: true });
  } catch (error: any) {
    console.error('Payment session creation error:', error);
    if (error?.name === 'RequestInvalidError') {
      console.error('PayRex validation errors:', JSON.stringify(error?.errors || [], null, 2));
    }
    return NextResponse.json(
      {
        error: error.message || 'Failed to create payment session',
        ...(Array.isArray(error?.errors) ? { provider_errors: error.errors } : {}),
      },
      { status: 500 }
    );
  }
}