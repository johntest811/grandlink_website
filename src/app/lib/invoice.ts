import fs from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import sharp from "sharp";

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
  companyLogoUrl?: string;
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

let companyLogoPdfBufferPromise: Promise<Buffer | null> | null = null;

async function getCompanyLogoPdfBuffer(): Promise<Buffer | null> {
  if (!companyLogoPdfBufferPromise) {
    companyLogoPdfBufferPromise = (async () => {
      try {
        const logoPath = path.join(process.cwd(), "public", "ge-logo.avif");
        const raw = await fs.readFile(logoPath);
        return await sharp(raw).png().toBuffer();
      } catch (error) {
        console.warn("Failed to prepare invoice logo for PDF", error);
        return null;
      }
    })();
  }

  return companyLogoPdfBufferPromise;
}

const money = (n: number, currency = "PHP") => {
  const v = Number.isFinite(n) ? n : 0;
  if (currency === "PHP") return `₱${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${v.toFixed(2)} ${currency}`;
};

export function renderInvoiceHtml(data: InvoiceData) {
  const issued = new Date(data.issuedAtIso);
  const logoHtml = data.companyLogoUrl
    ? `<img src="${escapeHtml(data.companyLogoUrl)}" alt="${escapeHtml(data.companyName)} logo" style="height:52px;width:auto;object-fit:contain;display:block;" />`
    : `<div style="font-size:22px;font-weight:800;letter-spacing:1px;">${escapeHtml(data.companyName)}</div>`;
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
        ${logoHtml}
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
          <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>Delivery Fee</span><span>${money(data.reservationFee, data.currency)}</span></div>
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

export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const doc = new PDFDocument({ size: "A4", margin: 48 });
        const chunks: Buffer[] = [];

        doc.on("data", (chunk) => chunks.push(chunk as Buffer));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const issued = new Date(data.issuedAtIso);
        const lineHeight = 18;
        const logoBuffer = await getCompanyLogoPdfBuffer();
        const headerTop = doc.y;

        if (logoBuffer) {
          doc.image(logoBuffer, 48, headerTop, { fit: [130, 52] });
        } else {
          doc.fontSize(20).fillColor("#111").text(data.companyName, 48, headerTop, { align: "left" });
        }

        doc.fontSize(10).fillColor("#555").text(data.companyAddress || "", 48, headerTop + 60);
        doc.text(data.companyEmail || "", 48, doc.y + 2);

        doc.fillColor("#111").fontSize(16).text(`Invoice ${data.invoiceNumber}`, 330, headerTop, { align: "right" });
        doc.fontSize(10).fillColor("#555").text(`Issued: ${issued.toLocaleString()}`, 330, headerTop + 24, { align: "right" });
        doc.text(`Order ID: ${data.orderId}`, 330, headerTop + 40, { align: "right" });
        doc.text(`Payment: ${(data.paymentMethod || "").toUpperCase() || "N/A"}`, 330, headerTop + 56, { align: "right" });

        doc.y = Math.max(doc.y, headerTop + 88);
        doc.moveDown(1.2);
        doc.fillColor("#111").fontSize(12).text("Billed To");
        doc.fontSize(10).fillColor("#333").text(data.customerName || "");
        doc.text(data.customerEmail || "");
        doc.text(data.customerPhone || "");
        doc.text(data.billingAddress || "");

        doc.moveDown(0.8);
        doc.fillColor("#111").fontSize(12).text("Fulfillment");
        doc.fontSize(10).fillColor("#333").text(`Method: ${String(data.deliveryMethod || "").toUpperCase() || "N/A"}`);
        if (String(data.deliveryMethod || "").toLowerCase() === "pickup") {
          doc.text(`Pickup branch: ${data.pickupBranch || "(not set)"}`);
        } else {
          doc.text(`Delivery: ${data.deliveryAddress || "(not set)"}`);
        }

        doc.moveDown(1);
        doc.fillColor("#111").fontSize(12).text("Items");
        doc.moveDown(0.3);

        const tableStartY = doc.y;
        doc.fontSize(10).fillColor("#111");
        doc.text("Description", 48, tableStartY);
        doc.text("Qty", 300, tableStartY, { width: 40, align: "right" });
        doc.text("Unit", 350, tableStartY, { width: 90, align: "right" });
        doc.text("Amount", 450, tableStartY, { width: 100, align: "right" });

        let rowY = tableStartY + 14;
        doc.moveTo(48, rowY - 4).lineTo(550, rowY - 4).strokeColor("#ddd").stroke();

        for (const line of data.lines) {
          doc.fillColor("#333").fontSize(10);
          doc.text(line.description, 48, rowY, { width: 240 });
          doc.text(String(line.quantity), 300, rowY, { width: 40, align: "right" });
          doc.text(money(line.unitPrice, data.currency), 350, rowY, { width: 90, align: "right" });
          doc.text(money(line.amount, data.currency), 450, rowY, { width: 100, align: "right" });
          rowY += lineHeight;
        }

        doc.moveTo(48, rowY - 2).lineTo(550, rowY - 2).strokeColor("#eee").stroke();
        rowY += 8;

        doc.fillColor("#111").fontSize(10);
        doc.text("Subtotal", 360, rowY, { width: 90, align: "right" });
        doc.text(money(data.subtotal, data.currency), 450, rowY, { width: 100, align: "right" });
        rowY += lineHeight;
        doc.text("Add-ons", 360, rowY, { width: 90, align: "right" });
        doc.text(money(data.addonsTotal, data.currency), 450, rowY, { width: 100, align: "right" });
        rowY += lineHeight;
        doc.text("Discount", 360, rowY, { width: 90, align: "right" });
        doc.text(`- ${money(data.discountValue, data.currency)}`, 450, rowY, { width: 100, align: "right" });
        rowY += lineHeight;
        doc.text("Delivery Fee", 360, rowY, { width: 90, align: "right" });
        doc.text(money(data.reservationFee, data.currency), 450, rowY, { width: 100, align: "right" });
        rowY += lineHeight;

        doc.fontSize(12).fillColor("#000").text("Total", 360, rowY, { width: 90, align: "right" });
        doc.text(money(data.totalAmount, data.currency), 450, rowY, { width: 100, align: "right" });

        doc.moveDown(2);
        doc.fontSize(9).fillColor("#666").text("This invoice is generated automatically after payment confirmation.");

        doc.end();
      } catch (error) {
        reject(error);
      }
    })();
  });
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
