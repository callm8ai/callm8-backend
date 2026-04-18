const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')
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

// POST manually add a client
router.post('/clients', requireAdminKey, async (req, res) => {
  const {
    business_name,
    owner_mobile,
    notify_email,
    business_type,
    twilio_number,
    plan = 'starter'
  } = req.body

  if (!business_name || !owner_mobile) {
    return res.status(400).json({ error: 'business_name and owner_mobile are required' })
  }

  try {
    // Save client to Supabase
    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        business_name,
        bland_number: twilio_number || null,
        owner_mobile,
        notify_sms: owner_mobile,
        notify_email: notify_email || null,
        business_type: business_type || 'general',
        plan,
        active: true
      })
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: 'Failed to save client', details: error })
    }

    // Send welcome SMS
    await sendSMS(
      owner_mobile,
      `Welcome to Callm8! We're now handling your missed calls. — Callm8`
    )

    res.json({
      success: true,
      client,
      message: 'Client created successfully'
    })

  } catch (err) {
    console.error('Client creation error:', err)
    res.status(500).json({ error: err.message })
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
