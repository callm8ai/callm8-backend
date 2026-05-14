const twilio = require('twilio')
const { sendSMS } = require('./sms')

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

async function purchaseAustralianNumber() {
  if (process.env.TEST_MODE === 'true') {
    console.log('🧪 TEST_MODE: skipping Twilio number purchase')
    return {
      success: true,
      number: process.env.TEST_BLAND_NUMBER,
      testMode: true
    }
  }
  try {
    const available = await client
      .availablePhoneNumbers('AU')
      .mobile.list({ limit: 1 })

    if (!available || available.length === 0) {
      throw new Error('No Australian mobile numbers available in Twilio')
    }

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber
    })

    console.log(`✅ Twilio number purchased: ${purchased.phoneNumber}`)
    return { success: true, number: purchased.phoneNumber }
  } catch (err) {
    console.error('Twilio number purchase failed:', err.message)
    await sendSMS(process.env.ADMIN_MOBILE, `🚨 Twilio number purchase failed for new client. Error: ${err.message}. Manual intervention needed.`)
    return { success: false, error: err.message }
  }
}

async function releaseNumber(phoneNumber) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping Twilio number release for ${phoneNumber}`)
    return { success: true }
  }
  try {
    const numbers = await client.incomingPhoneNumbers.list({
      phoneNumber
    })

    if (!numbers || numbers.length === 0) {
      console.warn(`No Twilio number found for ${phoneNumber}`)
      return { success: false, error: 'Number not found' }
    }

    await client.incomingPhoneNumbers(numbers[0].sid).remove()
    console.log(`✅ Twilio number released: ${phoneNumber}`)
    return { success: true }
  } catch (err) {
    console.error('Twilio number release failed:', err.message)
    return { success: false, error: err.message }
  }
}

module.exports = { purchaseAustralianNumber, releaseNumber }
