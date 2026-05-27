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

  console.log('Session data:', JSON.stringify({
    customer: session.customer,
    customer_details: session.customer_details,
    metadata: session.metadata
  }))

  let business_name = metadata.business_name
  let owner_mobile = metadata.owner_mobile
  let notify_email = metadata.notify_email
  let business_type = metadata.business_type
  let after_hours_message = metadata.after_hours_message
  let plan = metadata.plan

  if (!business_name || !owner_mobile) {
    console.log('No metadata found, fetching from Stripe customer object...')
    try {
      const customer = await stripe.customers.retrieve(session.customer)
      business_name = customer.metadata?.business_name || customer.name || 'Unknown Business'
      owner_mobile = customer.phone || customer.metadata?.owner_mobile || null
      notify_email = customer.email || null
      business_type = customer.metadata?.business_type || 'allied_health'
      after_hours_message = customer.metadata?.after_hours_message || ''
      plan = customer.metadata?.plan || 'starter'
      console.log(`Fetched from customer: ${business_name} | ${owner_mobile} | ${notify_email}`)
    } catch (err) {
      console.error('Failed to fetch Stripe customer:', err.message)
    }
  }

  if (!business_name || !owner_mobile) {
    console.log('Trying customer_details from session...')
    const details = session.customer_details || {}
    business_name = details.name || business_name || 'Unknown Business'
    owner_mobile = details.phone || owner_mobile || null
    notify_email = details.email || notify_email || null
    console.log(`From customer_details: ${business_name} | ${owner_mobile} | ${notify_email}`)
  }

  if (!business_name || !owner_mobile) {
    console.error('Missing required client data in Stripe session:', session.id)
    await sendSMS(process.env.ADMIN_MOBILE, `🚨 New payment but missing client data. Session: ${session.id}. Check Stripe manually.`)
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
      'Your Callm8 receptionist is being set up now',
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
      `You're live — your Callm8 number is ${assignedNumber}`,
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
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 20px;">

      <div style="background: #0a0a0a; padding: 32px 40px; border-radius: 4px 4px 0 0;">
        <p style="margin: 0; font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.3px;">callm8</p>
        <p style="margin: 4px 0 0; font-size: 12px; color: #888888; letter-spacing: 0.5px; text-transform: uppercase;">AI Receptionist</p>
      </div>

      <div style="background: #ffffff; padding: 40px 40px 32px; border: 1px solid #eeeeee;">
        <p style="font-size: 13px; color: #888888; margin: 0 0 24px; letter-spacing: 0.3px; text-transform: uppercase;">Welcome to Callm8</p>

        <h1 style="font-family: Georgia, serif; font-size: 26px; font-weight: normal; color: #0a0a0a; margin: 0 0 20px; line-height: 1.3;">Hi ${businessName} 👋</h1>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 16px;">
          Welcome to Callm8 — I'm setting up your AI receptionist and want to make sure it sounds exactly right for your clinic.
        </p>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 32px;">
          To get your agent configured, I just need a few details from you. Hit reply and answer the questions below — no need to format anything, just write it however feels natural.
        </p>

        <div style="border-top: 1px solid #eeeeee; margin: 0 0 32px;"></div>

        <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; letter-spacing: 0.5px; text-transform: uppercase; margin: 0 0 20px;">Setup questions</p>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">1. Receptionist preference</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0;">Would you prefer a male or female AI receptionist voice?</p>
        </div>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">2. Services &amp; clinic info</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0 0 10px;">What services does your clinic offer? (e.g. physiotherapy, massage, pilates, etc.)</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0;">Is there anything else about your clinic you'd like the receptionist to know — location, hours, parking, how to book, etc.?</p>
        </div>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">3. After-hours message</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0;">What would you like the receptionist to say when someone calls outside business hours?</p>
        </div>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">4. Booking link</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0 0 10px;">Do you have an online booking link (e.g. HotDoc, Calendly, or similar)? If so, paste it here.</p>
          <p style="font-size: 13px; color: #888888; line-height: 1.6; margin: 0; font-style: italic;">The agent can automatically send callers an SMS with the link so they can book straight away.</p>
        </div>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">5. FAQs (optional but recommended)</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0 0 10px;">If there are common questions your patients ask — about pricing, what to bring, cancellation policy, rebates, etc. — list them here along with the answers.</p>
          <p style="font-size: 13px; color: #888888; line-height: 1.6; margin: 0; font-style: italic;">Please include both the question and the answer — the agent needs both to respond accurately.</p>
        </div>

        <div style="margin-bottom: 40px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">6. Anything else?</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0;">Is there anything specific you'd like the receptionist to say, avoid saying, or handle in a particular way?</p>
        </div>

        <div style="border-top: 1px solid #eeeeee; margin: 0 0 32px;"></div>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 16px;">
          Once I have your answers I'll get the agent built and send you a test call so you can hear it in action before it goes live.
        </p>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 32px;">
          Any questions in the meantime, just reply here.
        </p>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 4px;">Cheers,</p>
        <p style="font-size: 15px; font-weight: 600; color: #0a0a0a; margin: 0;">Dan</p>
        <p style="font-size: 13px; color: #888888; margin: 4px 0 0;">Callm8</p>
      </div>

      <div style="background: #f8f8f8; padding: 24px 40px; border-radius: 0 0 4px 4px; border: 1px solid #eeeeee; border-top: none;">
        <a href="https://callm8.ai" style="font-size: 13px; color: #0a0a0a; text-decoration: none; font-weight: 500;">callm8.ai</a>
        <span style="font-size: 13px; color: #cccccc; margin: 0 8px;">·</span>
        <a href="mailto:hello@callm8.ai" style="font-size: 13px; color: #888888; text-decoration: none;">hello@callm8.ai</a>
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

router.buildSetupEmail = buildSetupEmail
router.buildWelcomeEmail = buildWelcomeEmail
module.exports = router
