# GrandLink Website

Next.js (App Router) customer-facing website for GrandLink.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Required environment variables

Create `website/grandlink_website/.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Server-side Supabase (used by secure API routes + webhooks)
SUPABASE_SERVICE_ROLE_KEY=...

# Invoice emailing (Gmail SMTP)
GMAIL_USER=your_gmail@gmail.com
GMAIL_PASS=your_gmail_app_password
GMAIL_FROM="GrandLink <your_gmail@gmail.com>"

# Optional: dedicated mailbox only for invoice/receipt emails
INVOICE_GMAIL_USER=invoice_bot@gmail.com
INVOICE_GMAIL_PASS=invoice_bot_app_password
INVOICE_GMAIL_FROM="GrandLink Invoices <invoice_bot@gmail.com>"

# Payment gateways / webhooks
PAYMONGO_SECRET_KEY=...
PAYMONGO_ENVIRONMENT=live
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYREX_SECRET_KEY=...
PAYREX_WEBHOOK_SECRET_KEY=...

# App URLs (used in invoice assets and callbacks)
NEXT_PUBLIC_BASE_URL=https://your-website-domain

# PayMongo
# Webhook signing secret from PayMongo Dashboard (Developers → Webhooks → your webhook → Signing secret)
PAYMONGO_WEBHOOK_SECRET=...
```

Notes:
- For Gmail, use an **App Password** (not your normal password).
- `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to the browser.
- If `INVOICE_GMAIL_*` is set, invoice/receipt emails use that mailbox first, and fall back to normal mail settings if unavailable.

## Database: invoices table

Invoices are stored in `public.invoices` and can be viewed by the customer.

1) Open Supabase SQL Editor
2) Run the migration in [invoices_schema.sql](invoices_schema.sql)

This migration:
- Creates `public.invoices`
- Adds indexes + `updated_at` trigger
- Enables RLS and adds a policy so users can read their own invoices

## Invoices (visible + emailed)

- Visible: customer can open an invoice at `/profile/invoice/[userItemId]`.
- Generated: on successful payment (via PayMongo/PayPal webhooks), the server ensures an invoice exists.
- Emailed: after invoice creation, the server attempts to send the invoice HTML to the customer email via Gmail SMTP.

If you don’t receive emails:
- Confirm `GMAIL_USER` / `GMAIL_PASS` are set on the **server runtime** (Vercel/hosting env vars).
- Check server logs for `Invoice email send failed`.

## Fulfillment: pickup vs delivery

Checkout and reservations support Pickup/Delivery. The selected method is persisted on the order/reservation in:
- `user_items.meta.delivery_method`
- `user_items.delivery_address_id` (delivery)
- `user_items.meta.selected_branch` / `user_items.meta.branch` (pickup)

## Webhook reminder

Payment gateways require a **public webhook URL**. For local testing, use something like ngrok and point PayMongo/PayPal webhooks to your `.../api/webhooks/*` endpoints.

## Vercel deployment checklist (invoice-safe)

1. Set all required environment variables in Vercel Project Settings for **Production** and **Preview** as needed.
2. Configure webhook URLs to your Vercel domain:
	- `/api/webhooks/paymongo`
	- `/api/webhooks/paypal`
	- `/api/webhooks/payrex`
3. Keep `PAYMONGO_SECRET_KEY` and `PAYPAL_*` credentials in matching mode (live for production).
4. Keep at least one valid SMTP sender configured (`INVOICE_GMAIL_*` recommended, otherwise `GMAIL_*`).
5. Verify one successful reservation payment and one successful cart checkout in production, then confirm invoice email delivery and `/profile/invoice/[userItemId]` rendering.

## PayMongo method policy

- PayMongo checkout is intentionally wallet-only in this app (`gcash`, `paymaya`/`maya`).
- Card-like methods (`card`, `credit`, `debit`, `credit_card`, `debit_card`) are filtered out server-side.
- If `PAYMONGO_PAYMENT_METHOD_TYPES` includes card-like values, the server ignores them and logs a warning.
