# Selvi Fireworks: online orders, WhatsApp, SMS and email

This turns the website from "orders stay in one browser" into a real system:

```
Customer's phone  ──►  Website (static files)  ──►  Supabase Edge Functions  ──►  Supabase database
                                                          │   (submit-order, get-order, admin-update)
                                                          ├──► WhatsApp  (Meta Cloud API)
                                                          ├──► SMS       (MSG91)
                                                          └──► Email     (Resend)
Owner  ──►  admin.html  (log in, check payment screenshot, mark Packed / Transporting / Arrived)
```

What it gives you:

* Orders, customers, bills and payment screenshots saved safely (bill numbers `SF26001`, `SF27001` …, no repeats).
* Prices are re-checked on the server, so a customer cannot change a price in the browser.
* The customer gets a WhatsApp, an SMS and (if they typed an email) an email when the order is placed, packed,
  transporting and arrived. You get an email for every new order and a "call this customer" email when a parcel arrives.
* `admin.html` for you and your friend to verify payments and update dispatch status from a phone.

Nothing here can be tested end to end until you create the accounts below. The code was tested on this computer with
a real Postgres test database and a mock server (see "Running the automated tests" at the bottom).

Time needed: about 1 hour for Supabase + email, then a few days of waiting for WhatsApp template and SMS (DLT) approvals.
You can go live with email only and add WhatsApp and SMS when they are approved. Missing channels are simply skipped.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com>, sign up, **New project**.
2. Name: `selvi-fireworks`. Region: **Mumbai (ap-south-1)**. Choose a strong database password and save it.
3. Wait a minute for it to start.
4. Open **Project Settings → API** and keep these tab open. You need:
   * **Project URL**  (for example `https://abcdefgh.supabase.co`)
   * **anon public** key (safe for the website)
   * **service_role** key (**secret**, never put it in the website or share it. The functions already receive it automatically.)

## 2. Create the tables

1. Dashboard → **SQL Editor → New query**.
2. Open `supabase/migrations/001_schema.sql` from this project, copy everything, paste, **Run**. It must say "Success".
3. New query again → paste `supabase/migrations/002_seed_products.sql` → **Run**. (This loads the 153 products and prices.)
4. New query again → paste `supabase/migrations/003_customers.sql` → **Run**. (Customer accounts and OTP login.)
5. New query again → paste `supabase/migrations/004_catalogue.sql` → **Run**. (Admin-managed products, categories, brands and settings.) Then log in at `admin.html` to manage them.

> **Whenever you change a price on the Book Now page**, run `python supabase/tools/gen_products_sql.py` and run the new
> `002_seed_products.sql` in the SQL editor again. The server uses its own copy of the prices; an order with a different
> price is refused with "Prices have changed".

## 3. Create the admin login

1. Dashboard → **Authentication → Users → Add user → Create new user**. Enter your email and a strong password,
   tick **Auto Confirm User**.
2. Copy the user's **UID** (a long code).
3. SQL Editor → run (replace the code):
   ```sql
   insert into public.admins (user_id, note) values ('PASTE-THE-UID-HERE', 'owner');
   ```
4. Repeat for your friend if needed. Only people in this table can read orders or open the admin page. Anyone else who
   logs in sees nothing.

## 4. Deploy the three functions

You need Node.js (you already have it). In a terminal, in the project folder:

```
npx supabase login
npx supabase init            (only the first time; accept the defaults. It will not overwrite the supabase folder)
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase functions deploy submit-order --no-verify-jwt
npx supabase functions deploy get-order    --no-verify-jwt
npx supabase functions deploy admin-update --no-verify-jwt
npx supabase functions deploy account      --no-verify-jwt
```

`YOUR-PROJECT-REF` is the first part of the Project URL (`abcdefgh` in `https://abcdefgh.supabase.co`).
`--no-verify-jwt` is correct here: each function does its own checks (admin-update requires a logged-in admin).

## 5. Add the secrets (settings the functions read)

Set them with the CLI. Only set the ones you have; skip the rest.

```
npx supabase secrets set SITE_URL=https://www.selvifireworks.com BUSINESS_PHONE="+91-91590-17999" ALLOWED_ORIGIN=https://www.selvifireworks.com
npx supabase secrets set ADMIN_EMAIL=owner@yourmail.com
npx supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="Selvi Fireworks <orders@selvifireworks.com>"
npx supabase secrets set WHATSAPP_TOKEN=EAAG... WHATSAPP_PHONE_ID=123456789012345 WA_LANG=en
npx supabase secrets set WA_TPL_PLACED=order_received WA_TPL_PACKED=order_packed WA_TPL_TRANSPORTING=order_transporting WA_TPL_ARRIVED=order_arrived WA_TPL_CANCELLED=order_cancelled WA_TPL_PAYMENT_REJECTED=payment_failed
npx supabase secrets set MSG91_AUTH_KEY=xxx MSG91_TPL_PLACED=templateid1 MSG91_TPL_PACKED=templateid2 MSG91_TPL_TRANSPORTING=templateid3 MSG91_TPL_ARRIVED=templateid4 MSG91_TPL_CANCELLED=templateid5 MSG91_TPL_PAYMENT_REJECTED=templateid6
```

npx supabase secrets set OTP_SECRET=any-long-random-text MSG91_TPL_OTP=otp-template-id WA_TPL_OTP=login_code
```

* `OTP_SECRET`: any long random text; it protects the stored login codes. `OTP_DEV_RETURN=1` makes the code appear on screen instead of being sent (testing only, never on the live site).
* `MSG91_TPL_OTP` / `WA_TPL_OTP`: the OTP SMS and WhatsApp templates (section 7 and 8). Login by mobile works as soon as one of the two is approved.

```
* While testing, use your own email in `ADMIN_EMAIL`, and `ALLOWED_ORIGIN=*`.
* `BUSINESS_PHONE`: the number customers should call. Use the official number when you go live.

## 6. Email with Resend

1. <https://resend.com> → sign up → **Domains → Add domain** `selvifireworks.com`. Add the DNS records it shows
   at the place where the domain is managed (your friend can do this). Wait until it says **Verified**.
2. **API Keys → Create** → copy the key into `RESEND_API_KEY`.
3. `MAIL_FROM` must use that domain, e.g. `Selvi Fireworks <orders@selvifireworks.com>`.

For a quick test before the domain is ready, Resend lets you send from `onboarding@resend.dev` to your own email only.

## 7. WhatsApp (Meta Cloud API)

1. <https://developers.facebook.com> → Create app → type **Business**. Add the **WhatsApp** product.
2. Add a phone number that is **not already used on a WhatsApp app** (a new SIM or number is best). Verify it.
3. Create a **System User** (Business Settings → Users → System users), give it the app with full control, and
   generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
   That token is `WHATSAPP_TOKEN`. The **Phone number ID** (WhatsApp → API Setup) is `WHATSAPP_PHONE_ID`.
4. **Message templates** (WhatsApp Manager → Message templates → Create). Category **Utility**, language **English**,
   one template for each name below. The text must be approved by Meta (usually minutes to a day). Keep the
   `{{1}}` numbers exactly; the website fills them in this order.

| Template name | Variables | Body text |
|---|---|---|
| `order_received` | `{{1}}` name, `{{2}}` bill no, `{{3}}` amount, `{{4}}` link | Hi {{1}}, thank you for your order {{2}} of {{3}} at Selvi Fireworks. Track your order and view your bill here: {{4}} |
| `order_packed` | `{{1}}` name, `{{2}}` bill no, `{{3}}` link | Hi {{1}}, your order {{2}} is packed at our Sivakasi factory. Track it here: {{3}} |
| `order_transporting` | same 3 | Hi {{1}}, your order {{2}} is on its way by transport. Track it here: {{3}} |
| `order_arrived` | same 3 | Hi {{1}}, your order {{2}} has arrived. Our team will call you shortly. Details: {{3}} |
| `order_cancelled` | same 3 | Hi {{1}}, your order {{2}} was cancelled. Please contact us if you have questions. Details: {{3}} |
| `login_code` | `{{1}}` code | Your Selvi Fireworks login code is {{1}}. It is valid for 10 minutes. Do not share it with anyone. |
| `payment_failed` | same 3 | Hi {{1}}, we could not verify the payment for order {{2}}. Please contact us. Details: {{3}} |

If you use different template names, change the matching `WA_TPL_...` secret.

## 8. SMS with MSG91 (India)

Indian SMS must follow DLT rules, so this takes a few days.

1. <https://msg91.com> → sign up and complete KYC.
2. Register the business on a DLT portal (Jio, Airtel, Vi or similar), then register a **Sender ID** (6 letters, e.g. `SELVIF`),
   your website domain as a **URL whitelist**, and the templates below as **Transactional** templates.
3. In MSG91 → **SMS → Flow** → create one flow per template, link the approved DLT template, and note each **Template ID**
   (these go into `MSG91_TPL_...`). Variable names must be `var1`, `var2`, `var3`.
4. **MSG91 → API → Auth key** → `MSG91_AUTH_KEY`.

Templates to register (the variables are filled by the website; the link text is fixed so the variables stay short):

| Flow (secret) | Text |
|---|---|
| `MSG91_TPL_PLACED` | Selvi Fireworks: Hi ##var1##, thank you! Your order ##var2## (##var3##) is received. Track: https://www.selvifireworks.com/vieworders.html |
| `MSG91_TPL_PACKED` | Selvi Fireworks: Hi ##var1##, your order ##var2## is packed at our Sivakasi factory. Track: https://www.selvifireworks.com/vieworders.html |
| `MSG91_TPL_TRANSPORTING` | Selvi Fireworks: Hi ##var1##, your order ##var2## is on its way by transport. Track: https://www.selvifireworks.com/vieworders.html |
| `MSG91_TPL_ARRIVED` | Selvi Fireworks: Hi ##var1##, your order ##var2## has arrived. Our team will call you shortly. |
| `MSG91_TPL_CANCELLED` | Selvi Fireworks: Hi ##var1##, your order ##var2## was cancelled. Please contact us for help. |
| `MSG91_TPL_OTP` | Your Selvi Fireworks login OTP is ##var1##. It is valid for 10 minutes. Do not share it with anyone. |
| `MSG91_TPL_PAYMENT_REJECTED` | Selvi Fireworks: Hi ##var1##, we could not verify the payment for order ##var2##. Please contact us. |

(`var1` = first name, `var2` = bill number, `var3` = amount, only for the first template.)

## 9. Connect the website

1. Open `assets/js/config.js` and fill in:
   ```js
   window.SELVI_CONFIG = {
     supabaseUrl: 'https://abcdefgh.supabase.co',
     anonKey: 'eyJ...your anon public key...'
   };
   ```
   Use the **anon** key only. Never the service_role key.
2. Upload the whole website folder to your hosting (any static host works). **Do not upload** the folders
   `assets/images/jpg (1)`, `jpg 2`, `new jpg`, `duplicates`, or `supabase/tests/node_modules`.
3. Open `https://your-site/admin.html` and log in with the admin user from step 3.

Once `config.js` has the URL and key, the site switches to online mode automatically. With them empty it keeps
working in "this browser only" test mode.

## 10. Test before going live (use your own number and email)

1. Put your own number and email in the Book Now form. Place an order of at least ₹5,000, pay a small real amount or just
   upload any screenshot for the test.
2. Check: you get the bill number; the order appears in `admin.html`; the screenshot opens; you receive the messages.
3. In the admin page click **Payment received**, then **Mark as Packed → Transporting → Arrived**. After each click your
   phone should get a WhatsApp and SMS, and the owner email gets "CALL CUSTOMER" on Arrived.
4. On another phone open `vieworders.html`, type the bill number and mobile number, and view the bill and Download PDF.
5. If a message does not arrive, open the order in admin: **Messages sent** shows `sent`, `failed` (with the reason) or
   `skipped` (that channel is not configured).
6. Finally swap the test phone and email for the official ones (the website `.html` files and `BUSINESS_PHONE` / `ADMIN_EMAIL`).

## Things to know

* **Payments are still checked by a person.** The customer pays by UPI and uploads a screenshot; someone must compare it with
  the bank account and click **Payment received**. Fully automatic confirmation needs a payment gateway (Razorpay, Cashfree,
  PhonePe Business). That is a separate, larger change; ask when you want it.
* **Login is required to book.** The order uses the mobile number the customer logged in with. To allow guest orders again, set the secret `REQUIRE_LOGIN=0` (and the website pages stay gated only in the browser, so also remove `gate.js` from `booknow.html`, `payment.html`, `vieworders.html`).
* **Privacy:** nobody can read the database directly. Customers see only their own order with bill number + mobile number
  (10 wrong guesses block that bill for an hour). Payment screenshots are in a private bucket that only admins can open.
* **Costs:** Supabase free plan is enough to start. Resend free: 3,000 emails/month. WhatsApp: Meta charges per conversation
  (utility messages are inexpensive in India). SMS: about ₹0.15 to ₹0.25 per message on MSG91.
* **Backups:** Supabase free plan keeps no daily backups. Download your data now and then (Table editor → export) or use a
  paid plan before real volume.
* **One person at a time on arrival call:** the "arrived" message promises a call; the owner email is the reminder to make it.

## Running the automated tests (developers)

```
cd supabase/tests
npm install
npm test            # 30 tests: database rules, bill numbers, pricing checks, messaging, admin actions
npm run mock        # a local fake backend on http://localhost:8787 (set __SELVI_TEST_CONFIG in a browser to use it)
```
