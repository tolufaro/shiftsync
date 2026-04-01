const express = require('express')

const app = express()

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

const port = process.env.PORT ? Number(process.env.PORT) : 3001

app.listen(port, () => {
  console.log(`ShiftSync backend listening on http://localhost:${port}`)
})

