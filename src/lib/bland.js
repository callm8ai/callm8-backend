const axios = require('axios')

const BLAND_BASE = 'https://api.bland.ai/v1'

const headers = () => ({
  authorization: process.env.BLAND_API_KEY,
  'Content-Type': 'application/json'
})

/* =========================
   IMPORT NUMBER VIA BYOT
   Tells Bland to pull in a Twilio number already
   connected via the BYOT add-on in the Bland dashboard.
========================= */
async function importTwilioNumber(phoneNumber) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping BYOT import for ${phoneNumber}`)
    return { success: true, testMode: true }
  }

  try {
    // Bland BYOT import — pulls the number from your connected Twilio account
    const res = await axios.post(
      `${BLAND_BASE}/inbound/purchase`,
      {
        phone_number: phoneNumber,
        encrypted_key: process.env.BLAND_ENCRYPTED_KEY // set after BYOT connect
      },
      { headers: headers() }
    )

    console.log('BYOT import response:', JSON.stringify(res.data))
    return { success: true }
  } catch (err) {
    console.error('BYOT import failed:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: err.response?.data || err.message }
  }
}

/* =========================
   CREATE AGENT
========================= */
async function createAgent(clientConfig) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping agent creation, using TEST_AGENT_ID`)
    return {
      success: true,
      agentId: process.env.TEST_AGENT_ID,
      testMode: true
    }
  }

  const {
    businessName,
    businessType = 'trades',
    afterHoursMessage
  } = clientConfig

  const webhookUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `${process.env.RAILWAY_PUBLIC_DOMAIN}/webhooks/bland`
    : null

  if (!webhookUrl) {
    console.warn('⚠️  RAILWAY_PUBLIC_DOMAIN not set — Bland webhook will not fire')
  }

  const prompt = `You are a professional receptionist for ${businessName}, a ${businessType} business.

Your job is to:
- Greet callers warmly and professionally
- Ask for their name and reason for calling
- If it's a job enquiry, get the type of work needed, their address, and best callback number
- Capture any urgency (e.g. emergency leak, no power, urgent repair)
- Let them know the owner will call them back shortly
- Keep calls efficient and under 2 minutes where possible

Always introduce yourself as the ${businessName} answering service.
Never quote prices or make bookings — just take a message.
${afterHoursMessage
    ? `After hours message to relay: ${afterHoursMessage}`
    : 'If asked about hours, say someone will be in touch shortly.'
  }`

  try {
    const response = await axios.post(
      `${BLAND_BASE}/agents`,
      {
        name: `${businessName} Receptionist`,
        prompt,
        voice: 'maya',
        language: 'en-AU',
        webhook: webhookUrl
      },
      { headers: headers() }
    )

    console.log('Agent created:', JSON.stringify(response.data))

    const agentId =
      response.data?.agent?.agent_id ||
      response.data?.agent_id ||
      response.data?.data?.agent_id ||
      response.data?.id

    if (!agentId) {
      console.error('No agent_id in response:', JSON.stringify(response.data))
      throw new Error('No agent_id returned from Bland')
    }

    return { success: true, agentId }
  } catch (err) {
    console.error('Agent creation failed:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: err.response?.data || err.message }
  }
}

/* =========================
   ASSIGN AGENT TO NUMBER
========================= */
async function assignAgentToNumber(phoneNumber, agentId) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping agent assignment`)
    return { success: true, testMode: true }
  }

  try {
    const res = await axios.post(
      `${BLAND_BASE}/inbound/${encodeURIComponent(phoneNumber)}`,
      { agent_id: agentId },
      { headers: headers() }
    )
    console.log('Agent assigned to number:', JSON.stringify(res.data))
    return { success: true }
  } catch (err) {
    console.error('Agent assignment failed:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: err.response?.data || err.message }
  }
}

/* =========================
   FULL ONBOARDING PIPELINE
   Called by both Stripe webhook (auto) and
   admin route (manual/test).
========================= */
async function onboardClient(rawData, twilioNumber) {
  const clientConfig = {
    businessName: rawData.business_name,
    ownerMobile: rawData.owner_mobile,
    businessType: rawData.business_type || 'trades',
    afterHoursMessage: rawData.after_hours_message
  }

  console.log(`🚀 Onboarding: ${clientConfig.businessName} | TEST_MODE: ${process.env.TEST_MODE}`)

  // In test mode, return hardcoded values immediately —
  // no purchasing, no importing, no agent creation
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 Using test number: ${process.env.TEST_BLAND_NUMBER}`)
    console.log(`🧪 Using test agent: ${process.env.TEST_AGENT_ID}`)
    return {
      success: true,
      phone_number: process.env.TEST_BLAND_NUMBER,
      agent_id: process.env.TEST_AGENT_ID,
      testMode: true
    }
  }

  // 1. Import Twilio number into Bland via BYOT
  const importResult = await importTwilioNumber(twilioNumber)
  if (!importResult.success) {
    throw new Error('Failed to import number into Bland: ' + JSON.stringify(importResult.error))
  }

  // 2. Create agent
  const agentResult = await createAgent(clientConfig)
  if (!agentResult.success) {
    throw new Error('Failed to create agent: ' + JSON.stringify(agentResult.error))
  }

  // 3. Assign agent to number
  const assignResult = await assignAgentToNumber(twilioNumber, agentResult.agentId)
  if (!assignResult.success) {
    throw new Error('Failed to assign agent to number: ' + JSON.stringify(assignResult.error))
  }

  return {
    success: true,
    phone_number: twilioNumber,
    agent_id: agentResult.agentId
  }
}

/* =========================
   DELETE AGENT
   Called when a client cancels their subscription
========================= */
async function deleteAgent(agentId) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping agent deletion`)
    return { success: true }
  }

  try {
    await axios.delete(`${BLAND_BASE}/agents/${agentId}`, { headers: headers() })
    console.log(`Agent ${agentId} deleted`)
    return { success: true }
  } catch (err) {
    console.error('Agent deletion failed:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: err.response?.data || err.message }
  }
}

module.exports = {
  importTwilioNumber,
  createAgent,
  assignAgentToNumber,
  onboardClient,
  deleteAgent
}
