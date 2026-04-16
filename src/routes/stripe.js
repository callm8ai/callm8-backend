const express = require('express')
const router = express.Router()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const supabase = require('../lib/supabase')
const { onboardClient } = require('../lib/bland')
const { purchaseAustralianNumber, releaseNumber } = require('../lib/twilio')
const { sendSMS } = require('../lib/sms')
const { sendEmail } = require('../lib/email')

/* =========================
   CREATE CHECKOUT SESSION
   Called by your frontend signup form.
   Accepts customer details + plan, creates a Stripe
   hosted checkout page and returns the URL.

   POST /webhooks/stripe/create-checkout-session
   Body: {
     business_name, owner_mobile, notify_email,
     business_type, after_hours_message, plan
   }
   plan: 'starter' ($99/mo) or 'pro' ($197/mo)
========================= */
router.post('/create-checkout-session', express.json(), async (req, res) => {
  const {
    business_name,
    owner_mobile,
    notify_email,
    business_type,
    after_hours_message,
    plan
  } = req.body

  if (!business_name || !owner_mobile || !notify_email) {
    return res.status(400).json({
      error: 'business_name, owner_mobile and notify_email are required'
    })
  }

  // Select price ID based on plan
  const priceId = plan === 'pro'
    ? process.env.STRIPE_PRICE_ID_PRO
    : process.env.STRIPE_PRICE_ID_STARTER

  if (!priceId) {
    return res.status(500).json({
      error: `No price ID configured for plan: ${plan || 'starter'}`
    })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      // Pass customer data through as metadata so the webhook can use it
      metadata: {
        business_name,
        owner_mobile,
        notify_email,
        business_type: business_type || 'trades',
        after_hours_message: after_hours_message || '',
        plan: plan || 'starter'
      },
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`
    })

    console.log(`Checkout session created: ${session.id} for ${business_name} (${plan || 'starter'})`)
    res.json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout session error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/* =========================
   STRIPE WEBHOOK HANDLER
   Receives events from Stripe.
   Must use raw body for signature verification —
   this is handled in index.js by skipping JSON
   middleware for this path.

   POST /webhooks/stripe
========================= */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  // Respond immediately — Stripe requires a fast 200
  res.status(200).json({ received: true })

  // Process asynchronously after responding
  try {
    if (event.type === 'checkout.session.completed') {
      await handleNewClient(event.data.object)
    }

    if (event.type === 'customer.subscription.deleted') {
      await handleCancelledClient(event.data.object)
    }
  } catch (error) {
    console.error('Stripe event processing error:', error)
  }
})

/* =========================
   NEW CLIENT HANDLER
   Fires when a customer completes checkout.
   Full auto-onboarding pipeline.
========================= */
async function handleNewClient(session) {
  const metadata = session.metadata || {}
  const {
    business_name,
    owner_mobile,
    notify_email,
    business_type,
    after_hours_message,
    plan
  } = metadata

  if (!business_name || !owner_mobile) {
    console.error('Missing required metadata in Stripe session:', session.id)
    return
  }

  console.log(`\n🎉 New client onboarding: ${business_name} (plan: ${plan || 'starter'})`)

  // Check for duplicate — Stripe can fire webhooks more than once
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('stripe_session_id', session.id)
    .single()

  if (existing) {
    console.log(`Session ${session.id} already processed, skipping`)
    return
  }

  let twilioNumber = null

  // 1. Purchase AU number from Twilio (skipped in TEST_MODE)
  if (process.env.TEST_MODE !== 'true') {
    const numberResult = await purchaseAustralianNumber()
    if (!numberResult.success) {
      console.error('Failed to purchase Twilio number for', business_name)
      return
    }
    twilioNumber = numberResult.number
    console.log(`✅ Twilio number purchased: ${twilioNumber}`)
  }

  // 2. Run Bland onboarding (import number, create agent, assign)
  let onboardResult
  try {
    onboardResult = await onboardClient(
      { business_name, owner_mobile, business_type, after_hours_message },
      twilioNumber
    )
  } catch (err) {
    console.error('Bland onboarding failed for', business_name, err.message)
    // If Bland fails after we bought the number, release it to avoid orphaned numbers
    if (twilioNumber && process.env.TEST_MODE !== 'true') {
      await releaseNumber(twilioNumber)
    }
    return
  }

  const assignedNumber = onboardResult.phone_number
  const agentId = onboardResult.agent_id

  // 3. Save client to Supabase
  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      business_name,
      bland_number: assignedNumber,
      bland_agent_id: agentId,
      owner_mobile,
      notify_sms: owner_mobile,
      notify_email,
      business_type: business_type || 'trades',
      stripe_customer_id: session.customer,
      stripe_session_id: session.id,
      plan: plan || 'starter',
      active: true
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to save client to Supabase:', error)
    return
  }

  console.log(`✅ Client ${business_name} saved (id: ${client.id})`)

  // 4. Send welcome SMS
  const welcomeSMS = [
    `Welcome to Callm8! 🎉`,
    `Your AI receptionist is now active.`,
    `Your Callm8 number: ${assignedNumber}`,
    `Forward your calls to this number and we'll handle every call you miss — 24/7.`,
    `— Callm8 Team`
  ].join('\n\n')

  await sendSMS(owner_mobile, welcomeSMS)

  // 5. Send welcome email
  if (notify_email) {
    await sendEmail(
      notify_email,
      `Welcome to Callm8 — Your number is ${assignedNumber}`,
      buildWelcomeEmail(business_name, assignedNumber, plan || 'starter')
    )
  }

  console.log(`✅ Onboarding complete for ${business_name} | Number: ${assignedNumber} | Plan: ${plan || 'starter'}\n`)
}

/* =========================
   CANCELLED CLIENT HANDLER
   Fires when a Stripe subscription is cancelled.
   Deactivates client, releases their number,
   deletes their Bland agent.
========================= */
async function handleCancelledClient(subscription) {
  console.log(`\n❌ Cancellation for Stripe customer: ${subscription.customer}`)

  // Look up the client
  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('stripe_customer_id', subscription.customer)
    .single()

  if (error || !client) {
    console.error('Could not find client for customer:', subscription.customer)
    return
  }

  // Deactivate in Supabase
  await supabase
    .from('clients')
    .update({ active: false })
    .eq('id', client.id)

  // Release Twilio number (frees up the number, stops billing)
  if (client.bland_number && process.env.TEST_MODE !== 'true') {
    await releaseNumber(client.bland_number)
  }

  // Delete Bland agent
  if (client.bland_agent_id && process.env.TEST_MODE !== 'true') {
    const { deleteAgent } = require('../lib/bland')
    await deleteAgent(client.bland_agent_id)
  }

  console.log(`✅ Client ${client.business_name} deactivated and cleaned up\n`)
}

/* =========================
   WELCOME EMAIL TEMPLATE
========================= */
function buildWelcomeEmail(businessName, blandNumber, plan) {
  const planLabel = plan === 'pro' ? 'Pro' : 'Starter'

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0D0D2B; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 28px;">Welcome to Callm8 👋</h1>
        <p style="color: #aaa; margin: 8px 0 0 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">${planLabel} Plan</p>
      </div>
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
        <p style="color: #333; font-size: 16px;">Hi ${businessName},</p>
        <p style="color: #333;">Your AI receptionist is live and ready to handle every call you miss.</p>

        <div style="background: #0D0D2B; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
          <p style="color: #aaa; margin: 0 0 5px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Your Callm8 Number</p>
          <h2 style="color: #FFFFFF; margin: 0; font-size: 32px; letter-spacing: 2px;">${blandNumber}</h2>
        </div>

        <p style="color: #333;"><strong>How to activate:</strong> Forward your mobile number to ${blandNumber}. When you can't answer, our AI will:</p>
        <ul style="color: #444; line-height: 2;">
          <li>Answer professionally on your behalf</li>
          <li>Capture the caller's name and reason for calling</li>
          <li>Send you an instant SMS + email summary</li>
        </ul>

        <p style="color: #333;">Questions? Reply to this email anytime.</p>
        <p style="color: #333;">— The Callm8 Team</p>

        <p style="margin-top: 30px; color: #999; font-size: 12px; text-align: center;">
          Powered by <strong>Callm8</strong> · callm8.ai
        </p>
      </div>
    </div>
  `
}

module.exports = router