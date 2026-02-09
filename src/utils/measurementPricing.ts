export type MeasurementPricingResult = {
  width_m?: number;
  height_m?: number;
  sqm_raw?: number;
  sqm_rounded?: number;
  sqm_billable?: number;
  unit_price_per_sqm: number;
  per_panel_price?: number;
  added_panels?: number;
  unit_price: number;
};

const toNumberOrUndefined = (value: unknown): number | undefined => {
  if (value === '' || value == null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const roundTo = (value: number, decimals: number) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

export const computeMeasurementPricing = (input: {
  widthMeters?: unknown;
  heightMeters?: unknown;
  unitPricePerSqm: unknown;
  minSqm?: number;
  sqmDecimals?: number;
  perPanelPrice?: unknown;
  addedPanels?: unknown;
}): MeasurementPricingResult => {
  const width_m = toNumberOrUndefined(input.widthMeters);
  const height_m = toNumberOrUndefined(input.heightMeters);

  const unit_price_per_sqm = Math.max(0, toNumberOrUndefined(input.unitPricePerSqm) ?? 0);
  const minSqm = Number.isFinite(input.minSqm) ? (input.minSqm as number) : 1;
  const sqmDecimals = Number.isFinite(input.sqmDecimals) ? (input.sqmDecimals as number) : 2;

  const per_panel_price = toNumberOrUndefined(input.perPanelPrice);
  const added_panels_raw = toNumberOrUndefined(input.addedPanels);
  const added_panels = added_panels_raw != null ? Math.max(0, Math.floor(added_panels_raw)) : undefined;

  let sqm_raw: number | undefined;
  let sqm_rounded: number | undefined;
  let sqm_billable: number | undefined;

  if (width_m != null && height_m != null && width_m > 0 && height_m > 0) {
    sqm_raw = width_m * height_m;
    sqm_rounded = roundTo(sqm_raw, sqmDecimals);
    sqm_billable = Math.max(minSqm, sqm_rounded);
  }

  const base = sqm_billable != null ? sqm_billable * unit_price_per_sqm : unit_price_per_sqm;
  const addon =
    per_panel_price != null && added_panels != null ? per_panel_price * added_panels : 0;

  const unit_price = Number.isFinite(base + addon) ? roundTo(base + addon, 2) : 0;

  return {
    width_m,
    height_m,
    sqm_raw,
    sqm_rounded,
    sqm_billable,
    unit_price_per_sqm,
    per_panel_price,
    added_panels,
    unit_price,
  };
};
