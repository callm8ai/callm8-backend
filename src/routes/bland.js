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

    // ✅ Ignore Bland log / debug events
    if (payload.message && payload.category) {
      console.log('⏭️ Ignoring Bland log event')
      return
    }

    const callId = payload.call_id
    const callerNumber = payload.from || payload.caller || 'Unknown'
    const toNumber = payload.to || payload.inbound_number
    const summary = payload.summary || payload.call_summary || null
    const transcript = payload.transcript || null
    const duration = payload.call_length || payload.duration || null
    const status = payload.status || 'completed'

    console.log(`📞 Call ID: ${callId} | To: ${toNumber} | From: ${callerNumber}`)

    if (!callId) {
      console.log('❌ No call_id, skipping')
      return
    }

    console.log('🔍 Checking for duplicate...')
    const { data: existing, error: dupError } = await supabase
      .from('calls')
      .select('id')
      .eq('call_id', callId)
      .maybeSingle()

    if (dupError) console.log('⚠️ Duplicate check error:', dupError.message)

    if (existing) {
      console.log(`⏭️ Already processed, skipping`)
      return
    }

    console.log('🔍 Looking up client for number:', toNumber)

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('bland_number', toNumber)
      .eq('active', true)
      .maybeSingle()

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
      call_id: callId,
      caller_number: callerNumber,
      summary,
      duration,
      created_at: new Date().toISOString()
    }

    if (client.notify_sms) {
      console.log('📱 Sending owner SMS...')
      await sendSMS(client.notify_sms, buildSMSBody(client, callRecord))
    }

    if (client.notify_email) {
      console.log('📧 Sending owner email...')
      const subject = `📞 Missed Call — ${callerNumber} | ${client.business_name}`
      await sendEmail(client.notify_email, subject, buildCallSummaryEmail(client, callRecord))
    }

    const bookingKeywords = ['book', 'appointment', 'schedule', 'booking', 'reserve']

    const needsBooking = bookingKeywords.some(word =>
      ((summary || '') + ' ' + (transcript || '')).toLowerCase().includes(word)
    )

    if (needsBooking && client.booking_url) {
      console.log('📅 Sending booking link to caller...')

      const callerSMS = `Hi! Thanks for calling ${client.business_name}. Book your appointment here: ${client.booking_url}`

      await sendSMS(callerNumber, callerSMS)
    }

    console.log(`✅ Webhook processing complete for call ${callId}`)

  } catch (error) {
    console.error('❌ Webhook error:', error.message)
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
