const axios = require('axios')

const BLAND_BASE = 'https://api.bland.ai/v1'

// 🔒 Safety switch
const DISABLE_PROVISIONING = true

const headers = () => ({
  authorization: process.env.BLAND_API_KEY,
  'Content-Type': 'application/json'
})

/* =========================
   PROVISION NUMBER (TEST SAFE)
========================= */
async function provisionNumber() {

  if (DISABLE_PROVISIONING) {
    console.log("🧪 PROVISIONING DISABLED (test mode)")
    return {
      success: true,
      number: "+61400000000",
      testMode: true
    }
  }

  const attempt = {
    country_code: "US",
    type: "local"
  }

  try {
    const res = await axios.post(
      `${BLAND_BASE}/inbound/purchase`,
      attempt,
      { headers: headers() }
    )

    console.log("Bland number response:", res.data)

    const number =
      res.data?.data?.phone_number ||
      res.data?.phone_number

    if (!number) throw new Error("No number returned")

    return {
      success: true,
      number
    }

  } catch (err) {
    console.log("Provision failed:", err.response?.data || err.message)

    return {
      success: false,
      error: err.response?.data || err.message
    }
  }
}


/* =========================
   CREATE AGENT (NEW MODEL)
========================= */
async function createAgent(clientConfig) {
  const {
    businessName,
    businessType = 'clinic',
    ownerMobile,
    afterHoursMessage
  } = clientConfig

  const prompt = `
You are a professional receptionist for ${businessName}, a ${businessType}.

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
${afterHoursMessage ? `After hours: ${afterHoursMessage}` : ''}
`

  try {
    const response = await axios.post(
      `${BLAND_BASE}/agents`,
      {
        name: `${businessName} Receptionist`,
        prompt,
        voice: 'maya',
        language: 'en-AU'
      },
      { headers: headers() }
    )

    console.log("Agent created:", response.data)

    const agentId = response.data?.agent_id

    if (!agentId) throw new Error("No agent_id returned")

    return {
      success: true,
      agentId,
      data: response.data
    }

  } catch (err) {
    console.log("Agent creation failed:", err.response?.data || err.message)

    return {
      success: false,
      error: err.response?.data || err.message
    }
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

  console.log("🚀 Onboarding client:", clientConfig)

  // 1️⃣ Provision number (optional now)
  const numberResult = await provisionNumber()

  if (!numberResult.success) {
    throw new Error("Failed to provision number")
  }

  // 2️⃣ Create agent (THIS IS THE IMPORTANT PART)
  const agentResult = await createAgent(clientConfig)

  if (!agentResult.success) {
    throw new Error("Failed to create agent")
  }

  // 3️⃣ RETURN CLEAN RESULT
  return {
    success: true,
    phone_number: numberResult.number,
    agent_id: agentResult.agentId,
    agent: agentResult.data
  }
}


/* =========================
   EXPORTS
========================= */
module.exports = {
  provisionNumber,
  createAgent,
  onboardClient
}