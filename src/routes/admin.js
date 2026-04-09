const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')
const { provisionNumber, configureInboundAgent } = require('../lib/bland')
const { sendSMS } = require('../lib/sms')

// Simple API key auth for admin routes
const requireAdminKey = (req, res, next) => {
  const key = req.headers['x-admin-key']
  if (key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorised' })
  }
  next()
}

// GET all clients
router.get('/clients', requireAdminKey, async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, business_name, bland_number, notify_sms, notify_email, plan, active, created_at')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error })
  res.json({ clients: data })
})

// GET client call history
router.get('/clients/:id/calls', requireAdminKey, async (req, res) => {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('client_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error })
  res.json({ calls: data })
})

// POST manually add a client (bypass Stripe for testing)
router.post('/clients', requireAdminKey, async (req, res) => {
  const {
    business_name,
    owner_mobile,
    notify_email,
    business_type,
    after_hours_message,
    plan = 'starter'
  } = req.body

  if (!business_name || !owner_mobile) {
    return res.status(400).json({ error: 'business_name and owner_mobile are required' })
  }

  try {
    // Provision Bland number
    const numberResult = await provisionNumber()
    if (!numberResult.success) {
      return res.status(500).json({ error: 'Failed to provision phone number', details: numberResult.error })
    }

    const blandNumber = numberResult.number

    // Configure Bland agent
    const agentResult = await configureInboundAgent(blandNumber, {
      businessName: business_name,
      ownerMobile: owner_mobile,
      businessType: business_type || 'clinic',
      afterHoursMessage: after_hours_message
    })

    if (!agentResult.success) {
      return res.status(500).json({ error: 'Failed to configure AI agent', details: agentResult.error })
    }

    // Save to Supabase
    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        business_name,
        bland_number: blandNumber,
        owner_mobile,
        notify_sms: owner_mobile,
        notify_email,
        business_type: business_type || 'clinic',
        plan,
        active: true
      })
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: 'Failed to save client', details: error })
    }

    // Send welcome SMS
    await sendSMS(owner_mobile, `Welcome to Callm8! Your number is ${blandNumber}. Share it with your customers and we'll handle every call you miss. — Callm8`)

    res.json({
      success: true,
      client,
      bland_number: blandNumber,
      message: `Client onboarded successfully. Number: ${blandNumber}`
    })

  } catch (error) {
    console.error('Manual onboarding error:', error)
    res.status(500).json({ error: error.message })
  }
})

// PATCH update client
router.patch('/clients/:id', requireAdminKey, async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error })
  res.json({ client: data })
})

// DELETE deactivate client
router.delete('/clients/:id', requireAdminKey, async (req, res) => {
  const { error } = await supabase
    .from('clients')
    .update({ active: false })
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error })
  res.json({ success: true, message: 'Client deactivated' })
})

// GET all calls (recent)
router.get('/calls', requireAdminKey, async (req, res) => {
  const { data, error } = await supabase
    .from('calls')
    .select('*, clients(business_name)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return res.status(500).json({ error })
  res.json({ calls: data })
})

module.exports = router
