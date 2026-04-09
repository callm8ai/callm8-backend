const express = require('express')
const router = express.Router()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const supabase = require('../lib/supabase')
const { provisionNumber, configureInboundAgent } = require('../lib/bland')
const { sendSMS } = require('../lib/sms')
const { sendEmail } = require('../lib/email')

// Stripe requires raw body for signature verification
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
    after_hours_message
  } = metadata

  if (!business_name || !owner_mobile) {
    console.error('Missing required metadata in Stripe session:', session.id)
    return
  }

  console.log(`New client onboarding: ${business_name}`)

  // 1. Provision Bland phone number
  const numberResult = await provisionNumber()
  if (!numberResult.success) {
    console.error('Failed to provision Bland number for', business_name)
    return
  }

  const blandNumber = numberResult.number
  console.log(`Provisioned number ${blandNumber} for ${business_name}`)

  // 2. Configure Bland AI agent
  const agentResult = await configureInboundAgent(blandNumber, {
    businessName: business_name,
    ownerMobile: owner_mobile,
    businessType: business_type || 'clinic',
    afterHoursMessage: after_hours_message
  })

  if (!agentResult.success) {
    console.error('Failed to configure Bland agent for', business_name)
    return
  }

  // 3. Save client to Supabase
  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      business_name,
      bland_number: blandNumber,
      owner_mobile,
      notify_sms: owner_mobile,
      notify_email,
      business_type: business_type || 'clinic',
      stripe_customer_id: session.customer,
      stripe_session_id: session.id,
      plan: 'starter',
      active: true
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to save client to Supabase:', error)
    return
  }

  console.log(`Client ${business_name} saved to Supabase with id ${client.id}`)

  // 4. Send welcome SMS to client
  const welcomeSMS = `Welcome to Callm8! 🎉\n\nYour AI receptionist is now active.\n\nYour Callm8 number: ${blandNumber}\n\nShare this number with your patients/customers and we'll handle every call you miss — 24/7.\n\n— Callm8 Team`
  await sendSMS(owner_mobile, welcomeSMS)

  // 5. Send welcome email
  if (notify_email) {
    await sendEmail(
      notify_email,
      `Welcome to Callm8 — Your number is ${blandNumber}`,
      buildWelcomeEmail(business_name, blandNumber)
    )
  }

  console.log(`Onboarding complete for ${business_name}`)
}

async function handleCancelledClient(subscription) {
  const { error } = await supabase
    .from('clients')
    .update({ active: false })
    .eq('stripe_customer_id', subscription.customer)

  if (error) {
    console.error('Failed to deactivate client:', error)
  } else {
    console.log(`Client deactivated for customer ${subscription.customer}`)
  }
}

function buildWelcomeEmail(businessName, blandNumber) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0D0D2B; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 28px;">Welcome to Callm8 👋</h1>
      </div>
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
        <p style="color: #333; font-size: 16px;">Hi ${businessName},</p>
        <p style="color: #333;">Your AI receptionist is live and ready to handle every call you miss.</p>
        
        <div style="background: #0D0D2B; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
          <p style="color: #aaa; margin: 0 0 5px 0; font-size: 13px;">YOUR CALLM8 NUMBER</p>
          <h2 style="color: #FFFFFF; margin: 0; font-size: 32px; letter-spacing: 2px;">${blandNumber}</h2>
        </div>

        <p style="color: #333;">Share this number with your patients and customers. When you can't answer, our AI will:</p>
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
