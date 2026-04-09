require('dotenv').config()
const express = require('express')
const app = express()

// Parse JSON for all routes except Stripe webhook
app.use((req, res, next) => {
  if (req.path === '/webhooks/stripe') {
    next()
  } else {
    express.json()(req, res, next)
  }
})

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'Callm8 Backend',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Routes
app.use('/webhooks/bland', require('./routes/bland'))
app.use('/webhooks/stripe', require('./routes/stripe'))
app.use('/admin', require('./routes/admin'))

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Callm8 backend running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
})

module.exports = app
