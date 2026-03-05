import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gijnybivawnsilzqegik.supabase.co";
const SUPA_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPA_SERVICE_ROLE) console.warn("Missing SUPABASE_SERVICE_ROLE_KEY in env");

const supabaseAdmin = createClient(SUPA_URL, SUPA_SERVICE_ROLE);

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const {
      id,
      full_name,
      first_name,
      last_name,
      phone,
      email,
      address,
      full_address,
      province,
      city,
      postal_code,
      label,
      is_default,
    } = body;
    if (!id) return NextResponse.json({ error: "missing address id" }, { status: 400 });

    const corePayload = {
      full_name,
      first_name,
      last_name,
      phone,
      email,
      address,
      is_default,
    };

    let { data, error } = await supabaseAdmin
      .from("addresses")
      .update({
        ...corePayload,
        full_address,
        province,
        city,
        postal_code,
        label,
      })
      .eq("id", id)
      .select()
      .single();

    const msg = String(error?.message || "").toLowerCase();
    if (error && (msg.includes("column") || msg.includes("schema cache") || msg.includes("pgrst"))) {
      const fallback = await supabaseAdmin
        .from("addresses")
        .update(corePayload)
        .eq("id", id)
        .select()
        .single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // notify the user (server-side) through notifyServers endpoint
    const siteBase = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:3000`;
    await fetch(`${siteBase}/api/notifyServers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "address_updated",
        user_id: data.user_id,
        title: "Address updated",
        message: "Your saved address was updated. If this was not you, contact support."
      }),
    }).catch(e => console.error("notifyServers call failed:", e));

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    console.error("addresses PATCH error", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, user_id } = body as { id?: string; user_id?: string };
    if (!id) return NextResponse.json({ error: "missing address id" }, { status: 400 });

    // Fetch the address to get owner for notifications and optional auth check
    const { data: addr, error: fetchErr } = await supabaseAdmin
      .from("addresses")
      .select("id, user_id, is_default, full_name, phone, address, first_name, last_name, email")
      .eq("id", id)
      .single();

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 404 });

    if (user_id && addr.user_id && user_id !== addr.user_id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Reassign any referencing rows in user_items before deletion
    // 1) Find a fallback address for the same user (not the one being deleted)
    const { data: fallbackRows, error: fallbackErr } = await supabaseAdmin
      .from("addresses")
      .select("id")
      .eq("user_id", addr.user_id)
      .neq("id", id)
      .order("created_at", { ascending: true })
      .limit(1);

    if (fallbackErr) return NextResponse.json({ error: fallbackErr.message }, { status: 500 });

    let fallbackId = fallbackRows && Array.isArray(fallbackRows) && fallbackRows.length > 0 ? fallbackRows[0].id : null;

    // 2) If no fallback exists, create a placeholder address (archived) to keep historical links valid
    if (!fallbackId) {
      const placeholderPayload = {
        user_id: addr.user_id,
        full_name: `[Archived] ${addr.full_name ?? "Address"}`,
        phone: addr.phone ?? "N/A",
        address: addr.address ?? "N/A",
        is_default: false,
        first_name: addr.first_name ?? null,
        last_name: addr.last_name ?? null,
        email: addr.email ?? null,
      } as any;

      const { data: created, error: createErr } = await supabaseAdmin
        .from("addresses")
        .insert([placeholderPayload])
        .select("id")
        .single();

      if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
      fallbackId = created.id;
    }

    // 3) Reassign any user_items referencing this address
    const { error: reErr } = await supabaseAdmin
      .from("user_items")
      .update({ delivery_address_id: fallbackId })
      .eq("delivery_address_id", id);

    if (reErr) return NextResponse.json({ error: reErr.message }, { status: 500 });

    // 4) Now delete the address
    const { error: delErr } = await supabaseAdmin
      .from("addresses")
      .delete()
      .eq("id", id);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    // Notify the user about the deletion
    const siteBase = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:3000`;
    await fetch(`${siteBase}/api/notifyServers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "address_deleted",
        user_id: addr.user_id,
        title: "Address removed",
        message: "An address was removed from your account.",
      }),
    }).catch((e) => console.error("notifyServers call failed:", e));

    return NextResponse.json({ ok: true, reassigned_to: fallbackId });
  } catch (err: any) {
    console.error("addresses DELETE error", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}