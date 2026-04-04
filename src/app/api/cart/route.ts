import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function getProductInventory(productId: string) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, inventory')
    .eq('id', productId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false as const, error: 'Product not found', productName: null as string | null, inventory: 0 };
  }

  const inventory = Math.max(0, Number((data as any).inventory ?? 0));
  const productName = String((data as any).name || 'Product');
  return { ok: true as const, inventory, productName };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const { data, error } = await supabase
      .from('cart')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ items: data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to load cart' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, productId, quantity = 1, meta = {} } = await request.json();
    if (!userId || !productId) {
      return NextResponse.json({ error: 'Missing userId or productId' }, { status: 400 });
    }

    const invRes = await getProductInventory(String(productId));
    if (!invRes.ok) {
      return NextResponse.json({ error: invRes.error }, { status: 404 });
    }
    if (invRes.inventory <= 0) {
      return NextResponse.json(
        { error: `${invRes.productName} is out of stock`, available: invRes.inventory },
        { status: 409 }
      );
    }
    const requestedQty = Math.max(1, Number(quantity || 1));

    // Check if item already in cart
    const { data: existing } = await supabase
      .from('cart')
      .select('id, quantity, meta')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .maybeSingle();

    if (existing) {
      // Update existing cart item
      const nextQty = Math.max(1, Number(existing.quantity || 0) + requestedQty);
      if (nextQty > invRes.inventory) {
        return NextResponse.json(
          {
            error: `Only ${invRes.inventory} unit(s) available for ${invRes.productName}`,
            available: invRes.inventory,
            current: Number(existing.quantity || 0),
          },
          { status: 409 }
        );
      }
      const { data, error } = await supabase
        .from('cart')
        .update({
          quantity: nextQty,
          meta: { ...(existing.meta || {}), ...(meta || {}) },
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ item: data, merged: true });
    }

    // Insert new cart item
    if (requestedQty > invRes.inventory) {
      return NextResponse.json(
        {
          error: `Only ${invRes.inventory} unit(s) available for ${invRes.productName}`,
          available: invRes.inventory,
        },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from('cart')
      .insert([{
        user_id: userId,
        product_id: productId,
        quantity: requestedQty,
        meta: meta || {},
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ item: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to add to cart' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, quantity, meta } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    if (typeof quantity === 'number') {
      const { data: cartItem, error: cartItemError } = await supabase
        .from('cart')
        .select('id, product_id, quantity')
        .eq('id', id)
        .maybeSingle();

      if (cartItemError || !cartItem) {
        return NextResponse.json({ error: 'Cart item not found' }, { status: 404 });
      }

      const invRes = await getProductInventory(String((cartItem as any).product_id));
      if (!invRes.ok) {
        return NextResponse.json({ error: invRes.error }, { status: 404 });
      }
      if (invRes.inventory <= 0) {
        return NextResponse.json(
          { error: `${invRes.productName} is out of stock`, available: invRes.inventory },
          { status: 409 }
        );
      }

      const requestedQty = Math.max(1, Number(quantity || 1));
      if (requestedQty > invRes.inventory) {
        return NextResponse.json(
          {
            error: `Only ${invRes.inventory} unit(s) available for ${invRes.productName}`,
            available: invRes.inventory,
            current: Number((cartItem as any).quantity || 0),
          },
          { status: 409 }
        );
      }
    }

    const payload: any = { updated_at: new Date().toISOString() };
    if (typeof quantity === 'number') payload.quantity = Math.max(1, quantity);
    if (meta) payload.meta = meta;

    const { data, error } = await supabase
      .from('cart')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ item: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update cart' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');
    const clear = searchParams.get('clear');

    if (clear === 'true' && userId) {
      const { error} = await supabase
        .from('cart')
        .delete()
        .eq('user_id', userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ success: true, cleared: true });
    }

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const { error } = await supabase
      .from('cart')
      .delete()
      .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to remove item' }, { status: 500 });
  }
}
