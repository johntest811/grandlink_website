"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../Clients/Supabase/SupabaseClients";
import {
  buildAddressPayloads,
  emptyAddressForm,
  formatAddressLineFromRecord,
  isAddressColumnError,
  toAddressFormFromRecord,
  type AddressFormFields,
} from "@/utils/addressFields";
import {
  getLocationDropdownOptions,
  getPhilippineLocationDropdownOptions,
  mergeLocationDropdownOptions,
  type LocationDropdownOptions,
} from "@/utils/locationSuggestions";

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
  const [savingAddress, setSavingAddress] = useState(false);
  const [remoteLocationOptions, setRemoteLocationOptions] = useState<LocationDropdownOptions>({
    provinceOptions: [],
    cityOptions: [],
    barangayOptions: [],
  });
  const [barangayOptionsLoading, setBarangayOptionsLoading] = useState(false);

  const locationOptions = useMemo(
    () =>
      getLocationDropdownOptions(
        addresses,
        addressForm.province,
        addressForm.city,
        addressForm.barangay
      ),
    [addresses, addressForm.province, addressForm.city, addressForm.barangay]
  );

  const mergedLocationOptions = useMemo(
    () => mergeLocationDropdownOptions(locationOptions, remoteLocationOptions),
    [locationOptions, remoteLocationOptions]
  );

  useEffect(() => {
    void fetchAddresses();
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadRemoteLocationOptions = async () => {
      setBarangayOptionsLoading(Boolean(addressForm.city.trim()));
      const nextOptions = await getPhilippineLocationDropdownOptions(
        addressForm.province,
        addressForm.city,
        addressForm.barangay
      );

      if (!isActive) return;

      setRemoteLocationOptions(nextOptions);
      setBarangayOptionsLoading(false);
    };

    void loadRemoteLocationOptions();

    return () => {
      isActive = false;
    };
  }, [addressForm.province, addressForm.city, addressForm.barangay]);

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

  const resetForm = () => {
    setAddressForm(emptyAddressForm());
  };

  function openAddForm() {
    setEditingId(null);
    resetForm();
    setShowForm(true);
  }

  function openEditForm(address: Address) {
    setEditingId(address.id);
    setAddressForm(toAddressFormFromRecord(address));
    setShowForm(true);
  }

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    resetForm();
  };

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

    setSavingAddress(true);
    try {
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

      await fetchAddresses();
      closeForm();
    } finally {
      setSavingAddress(false);
    }
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
      await fetchAddresses();
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
    await fetchAddresses();
  };

  const defaultAddress = addresses.find((item) => item.id === defaultId) ?? null;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="mx-auto max-w-5xl px-4">
        <div className="rounded-2xl bg-white p-6 shadow-md">
          <div className="flex flex-col gap-4 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[#8B1C1C]">My Addresses</h2>
              <p className="mt-1 text-sm text-gray-600">
                Manage your saved delivery locations and keep one default address for faster checkout.
              </p>
            </div>

            <button
              onClick={openAddForm}
              className="rounded-lg bg-[#8B1C1C] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#7a1919]"
            >
              + Add New Address
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {addresses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600">
                No saved addresses yet. Add one to use it on reservations and checkout.
              </div>
            ) : (
              addresses.map((addr) => {
                const isDefault = defaultId === addr.id;
                return (
                  <div
                    key={addr.id}
                    className={`rounded-lg border p-4 shadow-sm ${
                      isDefault ? "border-[#8B1C1C] bg-[#fff8f8]" : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-semibold text-gray-900">
                          {addr.full_name}
                          {isDefault ? (
                            <span className="ml-2 text-xs font-medium text-green-700">Default</span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-gray-700">{addr.phone}</div>
                        <div className="text-sm text-gray-700">{formatAddressLineFromRecord(addr)}</div>
                        {addr.email ? <div className="text-xs text-gray-600">{addr.email}</div> : null}
                      </div>

                      <div className="flex flex-col items-start gap-3 md:items-end">
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="radio"
                            name="defaultAddress"
                            checked={isDefault}
                            onChange={() => handleSetDefault(addr.id)}
                            className="accent-[#8B1C1C]"
                          />
                          Set as Default
                        </label>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openEditForm(addr)}
                            className="rounded border border-[#8B1C1C] px-3 py-1.5 text-sm text-[#8B1C1C] transition hover:bg-[#fff1f1]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(addr.id)}
                            className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {defaultAddress ? (
            <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-semibold text-gray-900">Default Address</div>
              <div className="mt-1 text-sm text-gray-700">{defaultAddress.full_name}</div>
              <div className="text-sm text-gray-700">{formatAddressLineFromRecord(defaultAddress)}</div>
            </div>
          ) : null}
        </div>
      </div>

      {showForm ? (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-lg font-bold text-gray-900">
                {editingId ? "Edit Address" : "Add New Address"}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                className="text-gray-500 transition hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAddress} className="space-y-3 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Full Name *</label>
                  <input
                    value={addressForm.full_name}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, full_name: e.target.value }))}
                    className="w-full rounded border px-3 py-2 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Gmail *</label>
                  <input
                    type="email"
                    value={addressForm.email}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, email: e.target.value }))}
                    className="w-full rounded border px-3 py-2 text-gray-900"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Phone Number *</label>
                <input
                  value={addressForm.phone}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-gray-900"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Province / Region *</label>
                  <input
                    value={addressForm.province}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, province: e.target.value }))}
                    list="profile-province-options"
                    placeholder="Type or pick a province/region"
                    className="w-full rounded border px-3 py-2 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">City *</label>
                  <input
                    value={addressForm.city}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, city: e.target.value }))}
                    list="profile-city-options"
                    placeholder="Type or pick a city"
                    className="w-full rounded border px-3 py-2 text-gray-900"
                    required
                  />
                </div>
              </div>

              <datalist id="profile-province-options">
                {mergedLocationOptions.provinceOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <datalist id="profile-city-options">
                {mergedLocationOptions.cityOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Barangay *</label>
                  <input
                    value={addressForm.barangay}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, barangay: e.target.value }))}
                    list="profile-barangay-options"
                    placeholder="Type or pick a barangay"
                    className="w-full rounded border px-3 py-2 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Postal Code *</label>
                  <input
                    value={addressForm.postal_code}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, postal_code: e.target.value }))}
                    className="w-full rounded border px-3 py-2 text-gray-900"
                    required
                  />
                </div>
              </div>

              <datalist id="profile-barangay-options">
                {mergedLocationOptions.barangayOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>

              <p className="-mt-1 text-xs text-gray-500">
                {barangayOptionsLoading && addressForm.city.trim()
                  ? "Loading PSGC barangay suggestions for the selected city..."
                  : "Type your barangay or choose from the suggestions for the selected city."}
              </p>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Street *</label>
                <textarea
                  value={addressForm.street}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, street: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-gray-900"
                  rows={3}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Full Address Preview</label>
                <input
                  value={`${addressForm.street}${addressForm.barangay ? `, ${addressForm.barangay}` : ""}${addressForm.city ? `, ${addressForm.city}` : ""}${addressForm.province ? `, ${addressForm.province}` : ""}${addressForm.postal_code ? `, ${addressForm.postal_code}` : ""}`}
                  className="w-full rounded border px-3 py-2 text-gray-900"
                  readOnly
                />
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={addressForm.is_default}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                />
                Set as default address
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded border border-gray-300 px-4 py-2 text-gray-700 transition hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAddress}
                  className="rounded bg-[#8B1C1C] px-4 py-2 text-white transition hover:bg-[#7a1919] disabled:opacity-60"
                >
                  {savingAddress ? "Saving..." : editingId ? "Save Changes" : "Save Address"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
