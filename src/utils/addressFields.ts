export type AddressFormFields = {
  full_name: string;
  email: string;
  phone: string;
  province: string;
  street: string;
  barangay: string;
  city: string;
  postal_code: string;
  is_default: boolean;
};

export type AddressRecordLike = {
  id?: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  full_address?: string | null;
  province?: string | null;
  city?: string | null;
  postal_code?: string | null;
  label?: string | null;
  is_default?: boolean | null;
};

export const emptyAddressForm = (): AddressFormFields => ({
  full_name: "",
  email: "",
  phone: "",
  province: "",
  street: "",
  barangay: "",
  city: "",
  postal_code: "",
  is_default: false,
});

export const splitFullName = (fullName: string) => {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (!normalized) return { first_name: "", last_name: "" };
  const parts = normalized.split(" ");
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts.slice(-1).join(""),
  };
};

export const composeAddressLine = (fields: Pick<AddressFormFields, "street" | "barangay" | "city" | "province" | "postal_code">) => {
  const values = [
    fields.street?.trim(),
    fields.barangay?.trim(),
    fields.city?.trim(),
    fields.province?.trim(),
    fields.postal_code?.trim(),
  ].filter(Boolean);

  return values.join(", ");
};

export const parseAddressLine = (addressValue: string) => {
  const parts = String(addressValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    street: parts[0] || "",
    barangay: parts[1] || "",
    city: parts[2] || "",
    province: parts[3] || "",
    postal_code: parts[4] || "",
  };
};

export const toAddressFormFromRecord = (record?: AddressRecordLike | null): AddressFormFields => {
  if (!record) return emptyAddressForm();

  const parsed = parseAddressLine(String(record.full_address || record.address || ""));
  const fullName = String(
    record.full_name ||
      [record.first_name || "", record.last_name || ""].join(" ").trim()
  );

  return {
    full_name: fullName,
    email: String(record.email || ""),
    phone: String(record.phone || ""),
    province: String(record.province || parsed.province || ""),
    street: String(parsed.street || ""),
    barangay: String(record.label || parsed.barangay || ""),
    city: String(record.city || parsed.city || ""),
    postal_code: String(record.postal_code || parsed.postal_code || ""),
    is_default: !!record.is_default,
  };
};

export const formatAddressLineFromRecord = (record?: AddressRecordLike | null) => {
  if (!record) return "";

  if (record.full_address && String(record.full_address).trim()) {
    return String(record.full_address).trim();
  }

  if (record.address && String(record.address).trim()) {
    return String(record.address).trim();
  }

  return composeAddressLine(toAddressFormFromRecord(record));
};

export const buildAddressPayloads = (form: AddressFormFields) => {
  const full_name = form.full_name.trim().replace(/\s+/g, " ");
  const phone = form.phone.trim();
  const email = form.email.trim();
  const address = composeAddressLine(form);
  const fullAddress = address;
  const { first_name, last_name } = splitFullName(full_name);

  const basePayload = {
    full_name,
    first_name: first_name || null,
    last_name: last_name || null,
    phone,
    email: email || null,
    address,
  };

  const extendedPayload = {
    ...basePayload,
    province: form.province.trim() || null,
    city: form.city.trim() || null,
    postal_code: form.postal_code.trim() || null,
    full_address: fullAddress || null,
    label: form.barangay.trim() || null,
  };

  return {
    basePayload,
    extendedPayload,
  };
};

export const isAddressColumnError = (errorMessage: string) => {
  const text = String(errorMessage || "").toLowerCase();
  return (
    text.includes("column") ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("pgrst")
  );
};
