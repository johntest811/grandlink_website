"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../Clients/Supabase/SupabaseClients";
import {
  buildAddressPayloads,
  emptyAddressForm,
  formatAddressLineFromRecord,
  isAddressColumnError,
  toAddressFormFromRecord,
  type AddressFormFields,
} from "@/utils/addressFields";

type Address = {
  id: string;
  user_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name: string;
  phone: string;
  email?: string | null;
  address: string;
  full_address?: string | null;
  province?: string | null;
  city?: string | null;
  postal_code?: string | null;
  label?: string | null;
  is_default: boolean;
  created_at?: string;
};

export default function AddressManager() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addressForm, setAddressForm] = useState<AddressFormFields>(emptyAddressForm());

  useEffect(() => {
    fetchAddresses();
  }, []);

  async function fetchAddresses() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setAddresses([]);
      setDefaultId(null);
      return;
    }

    const { data, error } = await supabase
      .from("addresses")
      .select("*")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("fetch addresses error", error);
      return;
    }

    const list = (data ?? []) as Address[];
    setAddresses(list);
    setDefaultId(list.find((a) => a.is_default)?.id ?? null);
  }

  async function notifyServersAddressUpdated(
    userId: string,
    title = "Address updated",
    message = "Your saved address was updated."
  ) {
    try {
      await fetch("/api/notifyServers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "address_updated",
          user_id: userId,
          title,
          message,
        }),
      });
    } catch (err) {
      console.error("notifyServers call failed", err);
    }
  }

  function openAddForm() {
    setEditingId(null);
    setAddressForm(emptyAddressForm());
    setShowForm(true);
  }

  function openEditForm(address: Address) {
    setEditingId(address.id);
    setAddressForm(toAddressFormFromRecord(address));
    setShowForm(true);
  }

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !addressForm.full_name.trim() ||
      !addressForm.email.trim() ||
      !addressForm.phone.trim() ||
      !addressForm.street.trim() ||
      !addressForm.barangay.trim() ||
      !addressForm.city.trim() ||
      !addressForm.province.trim() ||
      !addressForm.postal_code.trim()
    ) {
      alert("Please complete all required fields.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("You must be signed in to manage addresses.");
      return;
    }

    const { basePayload, extendedPayload } = buildAddressPayloads(addressForm);

    if (!basePayload.address) {
      alert("Please provide a valid full address.");
      return;
    }

    if (editingId) {
      if (addressForm.is_default) {
        const { error: clearErr } = await supabase
          .from("addresses")
          .update({ is_default: false })
          .eq("user_id", user.id)
          .neq("id", editingId);
        if (clearErr) {
          console.error("clear defaults error", clearErr);
        }
      }

      let { error: updErr } = await supabase
        .from("addresses")
        .update({
          ...extendedPayload,
          is_default: !!addressForm.is_default,
        })
        .match({ id: editingId, user_id: user.id });

      if (updErr && isAddressColumnError(updErr.message || "")) {
        const fallback = await supabase
          .from("addresses")
          .update({
            ...basePayload,
            is_default: !!addressForm.is_default,
          })
          .match({ id: editingId, user_id: user.id });
        updErr = fallback.error;
      }

      if (updErr) {
        console.error("update address error", updErr);
        alert("Could not update address");
        return;
      }

      await notifyServersAddressUpdated(
        user.id,
        "Address updated",
        "An address in your account was updated."
      );
    } else {
      const wantDefault = addressForm.is_default || addresses.length === 0;

      let insertRes = await supabase
        .from("addresses")
        .insert([
          {
            user_id: user.id,
            ...extendedPayload,
            is_default: false,
          },
        ])
        .select("id")
        .single();

      if (insertRes.error && isAddressColumnError(insertRes.error.message || "")) {
        insertRes = await supabase
          .from("addresses")
          .insert([
            {
              user_id: user.id,
              ...basePayload,
              is_default: false,
            },
          ])
          .select("id")
          .single();
      }

      if (insertRes.error) {
        console.error(insertRes.error);
        alert("Could not save address");
        return;
      }

      if (wantDefault && insertRes.data?.id) {
        await supabase.from("addresses").update({ is_default: false }).eq("user_id", user.id);
        await supabase
          .from("addresses")
          .update({ is_default: true })
          .match({ id: insertRes.data.id, user_id: user.id });
      }

      await notifyServersAddressUpdated(
        user.id,
        "Address added",
        "A new address was added to your account."
      );
    }

    setShowForm(false);
    setEditingId(null);
    setAddressForm(emptyAddressForm());
    fetchAddresses();
  };

  const handleDelete = async (id: string) => {
    const ok = window.confirm("Are you sure you want to delete this address?");
    if (!ok) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const res = await fetch(`/api/addresses`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, user_id: user.id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        const message =
          body?.error || (typeof body === "string" ? body : "") || "Failed to delete address.";
        alert(message);
        return;
      }

      if (defaultId === id) setDefaultId(null);
      fetchAddresses();
    } catch {
      alert("Something went wrong deleting the address. Please try again.");
    }
  };

  const handleSetDefault = async (id: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("addresses").update({ is_default: false }).eq("user_id", user.id);

    const { error } = await supabase
      .from("addresses")
      .update({ is_default: true })
      .match({ id, user_id: user.id });

    if (error) {
      console.error("set default error", error);
      return;
    }

    await notifyServersAddressUpdated(
      user.id,
      "Default address changed",
      "Your default address was changed."
    );

    setDefaultId(id);
    fetchAddresses();
  };

  const defaultAddress = addresses.find((item) => item.id === defaultId) ?? null;

  return (
    <div className="max-w-4xl mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg">
      <h2 className="text-2xl font-bold mb-6 text-[#8B1C1C]">My Addresses</h2>

      <button
        onClick={openAddForm}
        className="bg-[#8B1C1C] text-white px-4 py-2 rounded font-semibold hover:bg-[#a83232] transition mb-6"
      >
        + Add New Address
      </button>

      <div className="space-y-4">
        {addresses.map((addr) => (
          <div
            key={addr.id}
            className="border rounded-lg p-4 flex justify-between items-start shadow-sm"
          >
            <div>
              <p className="font-bold text-gray-800">
                {addr.full_name}
                <span className="ml-2 text-gray-600">({addr.phone})</span>
                {addr.is_default && (
                  <span className="ml-2 text-sm text-green-600">Default</span>
                )}
              </p>
              <p className="text-gray-700 mt-1">{formatAddressLineFromRecord(addr)}</p>
              {addr.email ? <p className="text-xs text-gray-600 mt-1">{addr.email}</p> : null}
            </div>

            <div className="flex flex-col items-end gap-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="defaultAddress"
                  checked={defaultId === addr.id}
                  onChange={() => handleSetDefault(addr.id)}
                  className="accent-[#8B1C1C]"
                />
                <span className="text-gray-700">Set as Default</span>
              </label>

              <div className="flex gap-3">
                <button
                  className="text-blue-600 hover:underline"
                  onClick={() => openEditForm(addr)}
                >
                  Edit
                </button>
                <button
                  className="text-red-600 hover:underline"
                  onClick={() => handleDelete(addr.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {defaultAddress && (
        <div className="mt-6 p-4 bg-gray-100 rounded">
          <p className="font-semibold text-gray-700">
            Default Address: <span className="font-normal">{defaultAddress.full_name}, {formatAddressLineFromRecord(defaultAddress)}</span>
          </p>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4 text-[#8B1C1C]">
              {editingId ? "Edit Address" : "Add New Address"}
            </h3>

            <form className="grid gap-4" onSubmit={handleSaveAddress}>
              <div>
                <label className="block font-semibold text-black">Full Name *</label>
                <input
                  type="text"
                  className="w-full border rounded px-3 py-2 text-black"
                  value={addressForm.full_name}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, full_name: e.target.value }))}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-black">Gmail *</label>
                  <input
                    type="email"
                    className="w-full border rounded px-3 py-2 text-black"
                    value={addressForm.email}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, email: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-black">Phone Number *</label>
                  <input
                    type="text"
                    className="w-full border rounded px-3 py-2 text-black"
                    value={addressForm.phone}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, phone: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-black">Province / Region *</label>
                  <input
                    type="text"
                    className="w-full border rounded px-3 py-2 text-black"
                    value={addressForm.province}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, province: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-black">City *</label>
                  <input
                    type="text"
                    className="w-full border rounded px-3 py-2 text-black"
                    value={addressForm.city}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, city: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-black">Barangay *</label>
                  <input
                    type="text"
                    className="w-full border rounded px-3 py-2 text-black"
                    value={addressForm.barangay}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, barangay: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-black">Postal Code *</label>
                  <input
                    type="text"
                    className="w-full border rounded px-3 py-2 text-black"
                    value={addressForm.postal_code}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, postal_code: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-black">Street *</label>
                <textarea
                  className="w-full border rounded px-3 py-2 text-black"
                  value={addressForm.street}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, street: e.target.value }))}
                  rows={3}
                  required
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={addressForm.is_default}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                  className="accent-[#8B1C1C]"
                />
                <span className="text-gray-700">Set as Default</span>
              </label>

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setAddressForm(emptyAddressForm());
                  }}
                  className="px-4 py-2 border rounded hover:bg-gray-100 text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#8B1C1C] text-white px-4 py-2 rounded font-semibold hover:bg-[#a83232] transition"
                >
                  {editingId ? "Save Changes" : "Save Address"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
