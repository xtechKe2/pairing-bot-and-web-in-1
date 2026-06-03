<div align="center">
  <h1>Mrxd-Baileys</h1>
  <p>A WebSocket-based JavaScript library for interacting with the WhatsApp Web API</p>
  
  [![npm version](https://img.shields.io/npm/v/mrxd-baileys.svg)](https://www.npmjs.com/package/mrxd-baileys)
  [![npm downloads](https://img.shields.io/npm/dm/mrxd-baileys.svg)](https://www.npmjs.com/package/mrxd-baileys)
  [![License](https://img.shields.io/npm/l/mrxd-baileys.svg)](https://github.com/XdKing2/mrxd-baileys/blob/main/LICENSE)
</div>

## Disclaimer

This project is not affiliated, associated, authorized, endorsed by, or in any way officially connected with WhatsApp or any of its subsidiaries or affiliates. Use at your own discretion. Do not spam people with this. We discourage any stalkerware, bulk or automated messaging usage.

## Installation

```bash
npm install mrxd-baileys
```

Or using yarn:
```bash
yarn add mrxd-baileys
```

## Quick Start

### CommonJS (Recommended)
```javascript
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('mrxd-baileys')
```

### ES Modules / TypeScript
```javascript
import pkg from 'mrxd-baileys'
const { default: makeWASocket, useMultiFileAuthState, Browsers } = pkg
```

## Features

- Full WhatsApp Web API support
- Multi-device support with QR code and pairing code authentication
- LID (Link ID) addressing support for both personal chats and groups
- Group status/story sending functionality
- Session management and restoration
- Message sending, receiving, and manipulation
- Group management
- Privacy settings
- Profile management
- And much more!

> **Note:** For sending buttons, please use the [gifted-btns](https://npmjs.com/package/gifted-btns) package.

## Documentation

Full documentation is available at [baileys.malvintech.sbs](https://baileys.malvintech.sbs)

