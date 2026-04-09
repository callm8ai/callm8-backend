const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')
const { sendSMS } = require('../lib/sms')
const { sendEmail, buildCallSummaryEmail } = require('../lib/email')

router.post('/', async (req, res) => {
  // Always respond 200 immediately to prevent Bland retrying
  res.status(200).json({ received: true })

  try {
    const payload = req.body
    console.log('Bland webhook received:', JSON.stringify(payload, null, 2))

    const callId = payload.call_id
    const callerNumber = payload.from || payload.caller || 'Unknown'
    const toNumber = payload.to || payload.inbound_number
    const summary = payload.summary || payload.call_summary || null
    const transcript = payload.transcript || null
    const duration = payload.call_length || payload.duration || null
    const status = payload.status || 'completed'

    if (!callId) {
      console.log('No call_id in payload, skipping')
      return
    }

    // DEDUPLICATION — check if we already processed this call
    const { data: existing } = await supabase
      .from('calls')
      .select('id')
      .eq('call_id', callId)
      .single()

    if (existing) {
      console.log(`Call ${callId} already processed, skipping`)
      return
    }

    // Look up which client owns this inbound number
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('bland_number', toNumber)
      .eq('active', true)
      .single()

    if (clientError || !client) {
      console.log(`No active client found for number ${toNumber}`)
      // Still save the call for debugging
      await supabase.from('calls').insert({
        call_id: callId,
        caller_number: callerNumber,
        inbound_number: toNumber,
        summary,
        transcript,
        duration,
        status,
        client_id: null,
        raw_payload: payload
      })
      return
    }

    // Save call to Supabase
    const { error: insertError } = await supabase.from('calls').insert({
      call_id: callId,
      client_id: client.id,
      caller_number: callerNumber,
      inbound_number: toNumber,
      summary,
      transcript,
      duration,
      status,
      raw_payload: payload
    })

    if (insertError) {
      console.error('Failed to save call:', insertError)
      return
    }

    console.log(`Call ${callId} saved for client ${client.business_name}`)

    // Build the call object for notifications
    const callRecord = {
      call_id: callId,
      caller_number: callerNumber,
      summary,
      transcript,
      duration,
      created_at: new Date().toISOString()
    }

    // Send SMS notification
    if (client.notify_sms) {
      const smsBody = buildSMSBody(client, callRecord)
      await sendSMS(client.notify_sms, smsBody)
    }

    // Send email notification
    if (client.notify_email) {
      const subject = `📞 Missed Call — ${callerNumber} | ${client.business_name}`
      const html = buildCallSummaryEmail(client, callRecord)
      await sendEmail(client.notify_email, subject, html)
    }

    console.log(`Notifications sent for call ${callId}`)

  } catch (error) {
    console.error('Webhook processing error:', error)
  }
})

function buildSMSBody(client, call) {
  const duration = call.duration
    ? `${Math.round(call.duration / 60)} min`
    : 'Unknown'

  const summary = call.summary
    ? `\n\n${call.summary}`
    : '\n\nNo summary captured.'

  return `📞 CALLM8 — Missed Call\n📱 ${call.caller_number}\n⏱ ${duration}${summary}\n\n— Callm8`
}

module.exports = router
