# Callm8 Backend

AI Secretary backend for the Callm8 service.

## Architecture

```
Bland AI (inbound call) → Webhook → Railway Backend → Supabase (save call)
                                                     → Twilio (SMS)
                                                     → Resend (email)
Stripe (new payment) → Webhook → Railway Backend → Bland API (provision number)
                                                 → Supabase (create client)
                                                 → Twilio (welcome SMS)
```

## Deploy to Railway

### Step 1 — Push code to GitHub
```bash
git init
git add .
git commit -m "Initial Callm8 backend"
git remote add origin https://github.com/YOUR_USERNAME/callm8-backend.git
git push -u origin main
```

### Step 2 — Connect to Railway
1. Go to railway.app
2. New Project → Deploy from GitHub repo
3. Select your callm8-backend repo
4. Railway will auto-detect Node.js and deploy

### Step 3 — Set environment variables in Railway
Go to your Railway project → Variables → Add all of these:

```
SUPABASE_URL=https://udxxjypaxkbhhwgjxscb.supabase.co
SUPABASE_ANON_KEY=your-anon-key
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM_NUMBER=+17407377710
RESEND_API_KEY=your-resend-key
RESEND_FROM_EMAIL=hello@callm8.ai
BLAND_API_KEY=your-bland-key
STRIPE_SECRET_KEY=your-stripe-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret
ADMIN_API_KEY=make-up-a-long-random-string-here
NODE_ENV=production
```

### Step 4 — Run Supabase schema
1. Go to supabase.com → your project → SQL Editor
2. Paste contents of schema.sql
3. Click Run

### Step 5 — Configure Bland webhook
1. Go to bland.ai dashboard
2. Set webhook URL to: https://YOUR-RAILWAY-DOMAIN/webhooks/bland
3. Enable: summary, transcript, call_length, from, to

### Step 6 — Configure Stripe webhook
1. Go to stripe.com → Developers → Webhooks
2. Add endpoint: https://YOUR-RAILWAY-DOMAIN/webhooks/stripe
3. Select events: checkout.session.completed, customer.subscription.deleted
4. Copy the webhook signing secret → add to Railway as STRIPE_WEBHOOK_SECRET

## API Endpoints

### Webhooks (public)
- POST /webhooks/bland — Bland AI call summary webhook
- POST /webhooks/stripe — Stripe payment webhook

### Admin (requires X-Admin-Key header)
- GET /admin/clients — List all clients
- POST /admin/clients — Manually add a client
- GET /admin/clients/:id/calls — Get call history for a client
- PATCH /admin/clients/:id — Update client details
- DELETE /admin/clients/:id — Deactivate client
- GET /admin/calls — Recent calls across all clients

### Health
- GET / — Service info
- GET /health — Health check

## Adding a client manually (for testing)

```bash
curl -X POST https://YOUR-RAILWAY-DOMAIN/admin/clients \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR-ADMIN-KEY" \
  -d '{
    "business_name": "Sydney Physio Co",
    "owner_mobile": "+61412345678",
    "notify_email": "owner@sydneyphysio.com",
    "business_type": "physio clinic",
    "plan": "starter"
  }'
```
