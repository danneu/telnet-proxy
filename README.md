# telnet-proxy

A Telnet to WebSocket proxy server.

## Installation

### Global Installation (Recommended)

```sh
npm install -g telnet-proxy
telnet-proxy
```

### Local Development

```sh
git clone https://github.com/danneu/telnet-proxy.git
cd telnet-proxy
pnpm install
pnpm run dev # dev
pnpm run start # prod
```

## Connect

```
wss://telnet-proxy.fly.dev/?host=elephant.org&port=23
```

Use query params when connecting to the server:

- `host`: string (required)
- `port`: number (optional, default: 23)
- `encoding`: `"auto"` | `"utf8"` | `"latin1"` | `"big5"` | `"gbk"`(optional, default: auto)
  - If you know the remote server encoding in advance, you can specify the encoding. Otherwise, the proxy will detect utf8 vs latin1 for you.
  - For `big5` and `gbk`, you must specify them.
- `mccp2`: string boolean (optional, default: false)
  - Whether to use MCCP2 compression.
