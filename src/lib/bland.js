const axios = require('axios')

const BLAND_BASE = 'https://api.bland.ai/v1'

// 🔒 Safety switch - set to false when ready for real provisioning
const DISABLE_PROVISIONING = true

const headers = () => ({
  authorization: process.env.BLAND_API_KEY,
  'Content-Type': 'application/json'
})

/* =========================
   PROVISION NUMBER
========================= */
async function provisionNumber() {
  if (DISABLE_PROVISIONING) {
    console.log('🧪 PROVISIONING DISABLED (test mode)')
    return {
      success: true,
      number: '+61400000000',
      testMode: true
    }
  }

  try {
    const res = await axios.post(
      `${BLAND_BASE}/inbound/purchase`,
      { country_code: 'US', type: 'local' },
      { headers: headers() }
    )
    console.log('Bland number response:', JSON.stringify(res.data))
    const number =
      res.data?.data?.phone_number ||
      res.data?.phone_number

    if (!number) throw new Error('No number returned')
    return { success: true, number }
  } catch (err) {
    console.log('Provision failed:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: err.response?.data || err.message }
  }
}

/* =========================
   CREATE AGENT
========================= */
async function createAgent(clientConfig) {
  const {
    businessName,
    businessType = 'clinic',
    ownerMobile,
    afterHoursMessage
  } = clientConfig

  const prompt = `You are a professional receptionist for ${businessName}, a ${businessType}.
Your job is to:
- Greet callers warmly
- Ask for name and reason for calling
- Take messages if owner is unavailable
- Capture urgency and callback details
- Keep calls short and professional
Always say you are the ${businessName} answering service.
If asked about appointments, say someone will call back.
Business: ${businessName}
Type: ${businessType}
${afterHoursMessage ? `After hours: ${afterHoursMessage}` : ''}`

  try {
    const response = await axios.post(
      `${BLAND_BASE}/agents`,
      {
        name: `${businessName} Receptionist`,
        prompt,
        voice: 'maya',
        language: 'en-AU',
        webhook: process.env.RAILWAY_PUBLIC_DOMAIN
          ? `${process.env.RAILWAY_PUBLIC_DOMAIN}/webhooks/bland`
          : null
      },
      { headers: headers() }
    )

    console.log('Agent created raw response:', JSON.stringify(response.data))

    // Bland can return agent_id at different levels
    const agentId =
      response.data?.agent?.agent_id ||
      response.data?.agent_id ||
      response.data?.data?.agent_id ||
      response.data?.id

    console.log('Resolved agentId:', agentId)

    if (!agentId) {
      // Log full response so we can debug
      console.error('Could not find agent_id in response:', JSON.stringify(response.data))
      throw new Error('No agent_id returned from Bland')
    }

    return { success: true, agentId, data: response.data }
  } catch (err) {
    console.log('Agent creation failed:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: err.response?.data || err.message }
  }
}

/* =========================
   FULL ONBOARDING PIPELINE
========================= */
async function onboardClient(rawData) {
  const clientConfig = {
    businessName: rawData.business_name,
    ownerMobile: rawData.owner_mobile,
    businessType: rawData.business_type,
    afterHoursMessage: rawData.after_hours_message
  }

  console.log('🚀 Onboarding client:', clientConfig)

  // 1. Provision number
  const numberResult = await provisionNumber()
  if (!numberResult.success) {
    throw new Error('Failed to provision number: ' + numberResult.error)
  }

  // 2. Create agent
  const agentResult = await createAgent(clientConfig)
  if (!agentResult.success) {
    throw new Error('Failed to create agent: ' + JSON.stringify(agentResult.error))
  }

  return {
    success: true,
    phone_number: numberResult.number,
    agent_id: agentResult.agentId,
    agent: agentResult.data
  }
}

module.exports = { provisionNumber, createAgent, onboardClient }