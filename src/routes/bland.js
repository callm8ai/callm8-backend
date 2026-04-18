const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')
const { sendSMS } = require('../lib/sms')
const { sendEmail, buildCallSummaryEmail } = require('../lib/email')

router.post('/', async (req, res) => {
  res.status(200).json({ received: true })
  try {
    const payload = req.body
    console.log('CALLM8:', payload.call_id, payload.to, payload.from, payload.status)
    const callId = payload.call_id
    const callerNumber = payload.from || payload.caller || 'Unknown'
    const toNumber = payload.to || payload.inbound_number
    const summary = payload.summary || payload.call_summary || null
    const duration = payload.call_length || payload.duration || null
    const status = payload.status || 'completed'

    if (!callId) return

    const { data: existing } = await supabase
      .from('calls')
      .select('id')
      .eq('call_id', callId)
      .single()

    if (existing) return

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('bland_number', toNumber)
      .eq('active', true)
      .single()

    if (!client) {
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
      await sendSMS(client.notify_sms, buildSMSBody(client, callRecord))
    }

    if (client.notify_email) {
      const subject = `📞 Missed Call — ${callerNumber} | ${client.business_name}`
      await sendEmail(client.notify_email, subject, buildCallSummaryEmail(client, callRecord))
    }

  } catch (error) {
    console.error('Webhook error:', error.message)
  }
})

function buildSMSBody(client, call) {
  const duration = call.duration ? `${Math.round(call.duration / 60)} min` : 'Unknown'
  const summary = call.summary ? `\n\n${call.summary}` : '\n\nNo summary captured.'
  return `📞 CALLM8 — Missed Call\n📱 ${call.caller_number}\n⏱ ${duration}${summary}\n\n— Callm8`
}

module.exports = router
