export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type InvoiceData = {
  invoiceNumber: string;
  issuedAtIso: string;
  companyName: string;
  companyAddress?: string;
  companyEmail?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  billingAddress?: string;
  deliveryMethod?: "delivery" | "pickup" | string;
  deliveryAddress?: string;
  pickupBranch?: string;
  orderId: string;
  paymentMethod?: string;
  currency: string;
  subtotal: number;
  addonsTotal: number;
  discountValue: number;
  reservationFee: number;
  totalAmount: number;
  lines: InvoiceLine[];
};

const money = (n: number, currency = "PHP") => {
  const v = Number.isFinite(n) ? n : 0;
  if (currency === "PHP") return `₱${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${v.toFixed(2)} ${currency}`;
};

export function renderInvoiceHtml(data: InvoiceData) {
  const issued = new Date(data.issuedAtIso);
  const deliveryRow =
    String(data.deliveryMethod || "").toLowerCase() === "pickup"
      ? `<div><strong>Pickup:</strong> ${escapeHtml(data.pickupBranch || "(not set)")}</div>`
      : `<div><strong>Delivery:</strong> ${escapeHtml(data.deliveryAddress || "(not set)")}</div>`;

  const linesHtml = data.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(l.description)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${l.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${money(l.unitPrice, data.currency)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${money(l.amount, data.currency)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Invoice ${escapeHtml(data.invoiceNumber)}</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;margin:0;background:#f6f7fb;color:#111;">
  <div style="max-width:900px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <div style="padding:24px;border-bottom:1px solid #eee;display:flex;gap:12px;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:22px;font-weight:800;letter-spacing:1px;">${escapeHtml(data.companyName)}</div>
        <div style="font-size:12px;color:#444;margin-top:6px;">${escapeHtml(data.companyAddress || "")}</div>
        <div style="font-size:12px;color:#444;">${escapeHtml(data.companyEmail || "")}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:14px;color:#444;">INVOICE</div>
        <div style="font-size:18px;font-weight:700;">${escapeHtml(data.invoiceNumber)}</div>
        <div style="font-size:12px;color:#444;margin-top:6px;">Issued: ${issued.toLocaleString()}</div>
        <div style="font-size:12px;color:#444;">Order ID: ${escapeHtml(data.orderId)}</div>
        <div style="font-size:12px;color:#444;">Payment: ${escapeHtml((data.paymentMethod || "").toUpperCase())}</div>
      </div>
    </div>

    <div style="padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:16px;border-bottom:1px solid #eee;">
      <div style="border:1px solid #eee;border-radius:10px;padding:14px;">
        <div style="font-weight:700;margin-bottom:8px;">Billed To</div>
        <div style="font-size:13px;">${escapeHtml(data.customerName || "")}</div>
        <div style="font-size:13px;color:#444;">${escapeHtml(data.customerEmail || "")}</div>
        <div style="font-size:13px;color:#444;">${escapeHtml(data.customerPhone || "")}</div>
        <div style="font-size:13px;color:#444;margin-top:6px;">${escapeHtml(data.billingAddress || "")}</div>
      </div>
      <div style="border:1px solid #eee;border-radius:10px;padding:14px;">
        <div style="font-weight:700;margin-bottom:8px;">Fulfillment</div>
        <div style="font-size:13px;">Method: ${escapeHtml(String(data.deliveryMethod || "").toUpperCase())}</div>
        <div style="font-size:13px;color:#444;margin-top:6px;">${deliveryRow}</div>
      </div>
    </div>

    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">Item</th>
            <th style="text-align:right;padding:8px;border-bottom:2px solid #e5e7eb;">Qty</th>
            <th style="text-align:right;padding:8px;border-bottom:2px solid #e5e7eb;">Unit</th>
            <th style="text-align:right;padding:8px;border-bottom:2px solid #e5e7eb;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${linesHtml}
        </tbody>
      </table>

      <div style="margin-top:18px;display:flex;justify-content:flex-end;">
        <div style="min-width:320px;border:1px solid #eee;border-radius:10px;padding:14px;">
          <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>Subtotal</span><span>${money(data.subtotal, data.currency)}</span></div>
          <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>Add-ons</span><span>${money(data.addonsTotal, data.currency)}</span></div>
          <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>Discount</span><span>- ${money(data.discountValue, data.currency)}</span></div>
          <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>Reservation Fee</span><span>${money(data.reservationFee, data.currency)}</span></div>
          <div style="height:1px;background:#eee;margin:10px 0;"></div>
          <div style="display:flex;justify-content:space-between;margin:6px 0;font-weight:800;font-size:14px;"><span>Total</span><span>${money(data.totalAmount, data.currency)}</span></div>
        </div>
      </div>

      <div style="margin-top:18px;font-size:12px;color:#444;">
        <div><strong>Notes</strong></div>
        <div>This invoice is generated automatically after payment confirmation.</div>
      </div>
    </div>

    <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#666;display:flex;justify-content:space-between;">
      <div>GrandLink Admin & Website</div>
      <div>Invoice ${escapeHtml(data.invoiceNumber)}</div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
