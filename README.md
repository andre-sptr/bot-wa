# bot-wa

WhatsApp automation assistant built with Node.js, Express, WAHA integration, scheduled jobs, and AI-assisted responses.

## Features

- WAHA-based WhatsApp session integration.
- AI response workflow using Anthropic/Sumopod-compatible configuration.
- Chat context handling.
- Scheduled jobs with `node-cron`.
- Policy, live, and quality evaluation test scripts.

## Tech Stack

- Node.js
- Express
- WAHA
- Anthropic SDK
- Axios
- Node Cron

## Getting Started

```bash
npm install
npm start
```

Run the available checks:

```bash
npm run test:all
```

## Environment Variables

Copy `.env.example` to `.env` and fill in local values. Do not commit real `.env` files.

## Status

Active automation project.