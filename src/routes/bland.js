const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')
const { sendSMS } = require('../lib/sms')
const { sendEmail, buildCallSummaryEmail } = require('../lib/email')

router.post('/', async (req, res) => {
  res.status(200).json({ received: true })
  console.log('🔔 Bland webhook received')
  try {
    const payload = req.body
    console.log('📦 Payload keys:', Object.keys(payload))
    const callId = payload.call_id
    const callerNumber = payload.from || payload.caller || 'Unknown'
    const toNumber = payload.to || payload.inbound_number
    const summary = payload.summary || payload.call_summary || null
    const transcript = payload.transcript || null
    const duration = payload.call_length || payload.duration || null
    const status = payload.status || 'completed'

    console.log(`📞 Call ID: ${callId} | To: ${toNumber} | From: ${callerNumber} | Status: ${status}`)

    if (!callId) {
      console.log('❌ No call_id, skipping')
      return
    }

    console.log('🔍 Checking for duplicate...')
    const { data: existing, error: dupError } = await supabase
      .from('calls')
      .select('id')
      .eq('call_id', callId)
      .single()

    if (dupError) console.log('⚠️ Duplicate check error:', dupError.message)
    if (existing) {
      console.log(`⏭️ Call ${callId} already processed, skipping`)
      return
    }

    console.log('🔍 Looking up client for number:', toNumber)
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('bland_number', toNumber)
      .eq('active', true)
      .single()

    if (clientError) console.log('⚠️ Client lookup error:', clientError.message)

    if (!client) {
      console.log(`⚠️ No client found for ${toNumber}, saving orphan call`)
      await supabase.from('calls').insert({
        call_id: callId,
        caller_number: callerNumber,
        inbound_number: toNumber,
        summary,
        duration,
        status,
        client_id: null
      })
      return
    }

    console.log(`✅ Client found: ${client.business_name}`)

    await supabase.from('calls').insert({
      call_id: callId,
      client_id: client.id,
      caller_number: callerNumber,
      inbound_number: toNumber,
      summary,
      duration,
      status
    })

    const callRecord = {
      c
