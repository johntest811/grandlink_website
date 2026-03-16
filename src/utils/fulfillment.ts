export type FulfillmentMethod = "delivery" | "pickup";

// Single pickup location requested by spec.
export const PICKUP_ADDRESS =
  "TAYTAY Main8004 National Road, Sitio Bangiad Brgy. San Juan, Taytay, Rizal";

export function normalizeFulfillmentMethod(value: unknown): FulfillmentMethod {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  return v === "pickup" ? "pickup" : "delivery";
}

export function getMetaFulfillmentMethod(meta: any): FulfillmentMethod {
  if (!meta) return "delivery";
  return normalizeFulfillmentMethod(meta.delivery_method || meta.fulfillment_method);
}
