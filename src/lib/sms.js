const twilio = require('twilio')

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

async function sendSMS(to, body) {
  try {
    const message = await client.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to,
      body
    })
    console.log(`SMS sent to ${to}: ${message.sid}`)
    return { success: true, sid: message.sid }
  } catch (error) {
    console.error(`SMS failed to ${to}:`, error.message)
    return { success: false, error: error.message }
  }
}

module.exports = { sendSMS }
