const express = require('express')
const router = express.Router()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const supabase = require('../lib/supabase')
const { onboardClient } = require('../lib/bland')
const { purchaseAustralianNumber, releaseNumber } = require('../lib/twilio')
const { sendSMS } = require('../lib/sms')
const { sendEmail } = require('../lib/email')

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
      metadata: {
        business_name,
        owner_mobile,
        notify_email,
        business_type: business_type || 'allied_health',
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

  res.status(200).json({ received: true })

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

  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('stripe_session_id', session.id)
    .single()

  if (existing) {
    console.log(`Session ${session.id} already processed, skipping`)
    return
  }

  if (notify_email) {
    await sendEmail(
      notify_email,
      'One quick step before you go live — Callm8',
      buildSetupEmail(business_name),
      'hello@callm8.ai'
    )
    console.log(`✅ Setup email sent to ${notify_email}`)
  }

  let twilioNumber = null

  if (process.env.TEST_MODE !== 'true') {
    const numberResult = await purchaseAustralianNumber()
    if (!numberResult.success) {
      console.error('Failed to purchase Twilio number for', business_name)
      return
    }
    twilioNumber = numberResult.number
    console.log(`✅ Twilio number purchased: ${twilioNumber}`)
  }

  let onboardResult
  try {
    onboardResult = await onboardClient(
      { business_name, owner_mobile, business_type, after_hours_message },
      twilioNumber
    )
  } catch (err) {
    console.error('Bland onboarding failed for', business_name, err.message)
    if (twilioNumber && process.env.TEST_MODE !== 'true') {
      await releaseNumber(twilioNumber)
    }
    return
  }

  const assignedNumber = onboardResult.phone_number
  const agentId = onboardResult.agent_id

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      business_name,
      bland_number: assignedNumber,
      bland_agent_id: agentId,
      owner_mobile,
      notify_sms: owner_mobile,
      notify_email,
      business_type: business_type || 'allied_health',
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

  const welcomeSMS = [
    `Welcome to Callm8! 🎉`,
    `Your AI receptionist is now active.`,
    `Your Callm8 number: ${assignedNumber}`,
    `Forward your calls to this number and we'll handle every call you miss — 24/7.`,
    `— Callm8 Team`
  ].join('\n\n')

  await sendSMS(owner_mobile, welcomeSMS)

  if (notify_email) {
    await sendEmail(
      notify_email,
      `Your Callm8 number is ready — ${assignedNumber}`,
      buildWelcomeEmail(business_name, assignedNumber, plan || 'starter')
    )
  }

  console.log(`✅ Onboarding complete for ${business_name} | Number: ${assignedNumber} | Plan: ${plan || 'starter'}\n`)
}

async function handleCancelledClient(subscription) {
  console.log(`\n❌ Cancellation for Stripe customer: ${subscription.customer}`)

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('stripe_customer_id', subscription.customer)
    .single()

  if (error || !client) {
    console.error('Could not find client for customer:', subscription.customer)
    return
  }

  await supabase
    .from('clients')
    .update({ active: false })
    .eq('id', client.id)

  if (client.bland_number && process.env.TEST_MODE !== 'true') {
    await releaseNumber(client.bland_number)
  }

  if (client.bland_agent_id && process.env.TEST_MODE !== 'true') {
    const { deleteAgent } = require('../lib/bland')
    await deleteAgent(client.bland_agent_id)
  }

  console.log(`✅ Client ${client.business_name} deactivated and cleaned up\n`)
}

function buildSetupEmail(businessName) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0D0D2B; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 28px;">You're almost live 🎉</h1>
      </div>
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
        <p style="color: #333; font-size: 16px;">Hey ${businessName},</p>
        <p style="color: #333;">Payment confirmed — your Callm8 receptionist is being set up now. You'll receive your dedicated number within a few hours.</p>
        <p style="color: #333;">While I get that sorted, I just need a couple of details to personalise your agent:</p>
        <ol style="color: #444; line-height: 2.2;">
          <li>
            What's your clinic name and how should the receptionist answer calls?<br>
            <em style="color: #999;">(e.g. "Thanks for calling Sunrise Physio, you've reached our after-hours receptionist")</em>
          </li>
          <li>
            Any specific information you want captured from callers?<br>
            <em style="color: #999;">(e.g. reason for call, preferred callback time)</em>
          </li>
          <li>Any FAQs you'd like your agent to know the answer to?</li>
          <li>Your booking/calendar link if you'd like it sent to callers automatically</li>
        </ol>
        <p style="color: #333;">Just reply to this email — takes 2 minutes.</p>
        <p style="color: #333;">— Dan<br>Callm8</p>
        <p style="margin-top: 30px; color: #999; font-size: 12px; text-align: center;">
          Powered by <strong>Callm8</strong> · callm8.ai
        </p>
      </div>
    </div>
  `
}

function buildWelcomeEmail(businessName, blandNumber, plan) {
  const planLabel = plan === 'pro' ? 'Growing Clinic' : 'Solo Practice'

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0D0D2B; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 28px;">You're live 👋</h1>
        <p style="color: #aaa; margin: 8px 0 0 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">${planLabel} Plan</p>
      </div>
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
        <p style="color: #333; font-size: 16px;">Hi ${businessName},</p>
        <p style="color: #333;">Your AI receptionist is live and ready to handle every call you miss.</p>

        <div style="background: #0D0D2B; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
          <p style="color: #aaa; margin: 0 0 5px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Your Callm8 Number</p>
          <h2 style="color: #FFFFFF; margin: 0; font-size: 32px; letter-spacing: 2px;">${blandNumber}</h2>
        </div>

        <p style="color: #333;"><strong>One step to activate:</strong> Forward your clinic number to ${blandNumber}. When you can't answer, your AI receptionist will:</p>
        <ul style="color: #444; line-height: 2;">
          <li>Answer professionally on your behalf</li>
          <li>Capture the caller's name and reason for calling</li>
          <li>Send you an instant SMS + email summary</li>
          <li>Send callers a booking link via SMS if they need an appointment</li>
        </ul>

        <p style="color: #333;">Questions? Reply to this email anytime.</p>
        <p style="color: #333;">— Dan<br>Callm8</p>

        <p style="margin-top: 30px; color: #999; font-size: 12px; text-align: center;">
          Powered by <strong>Callm8</strong> · callm8.ai
        </p>
      </div>
    </div>
  `
}

module.exports = router
