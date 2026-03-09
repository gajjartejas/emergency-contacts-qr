# Emergency Contacts + Payment QR (PWA)

A mobile-first single-page app for emergency calling and payment QR display.

- Frontend: plain HTML/CSS/JS (no external libraries)
- Backend: dependency-free Node.js server (JSON on disk)
- Offline: service worker + local browser cache
- Hosting: Raspberry Pi friendly, single container

## Features

- Contacts CRUD (`name`, `phone`) with `tel:` tap-to-call
- Contact delete supports soft-delete (archive) and hard-delete (permanent)
- QR CRUD (`label`, `upi_id`, optional image upload)
- Auto-generate QR from UPI ID when image is not uploaded
- QR full-size open in new tab for scanning
- Export/import JSON (merge or overwrite)
- Clear all data with confirmation
- Local cache persistence (`localStorage`) and offline use
- Optional server-backed JSON storage
- Optional API token for server protection

## Quick Start (Local)

```bash
npm start
```

Open: `http://<pi-ip>:8080`

## Environment Variables

- `PORT` (default: `8080`)
- `HOST` (default: `0.0.0.0`)
- `MAX_UPLOAD_BYTES` (default: `2097152` = 2 MB)
- `MAX_BODY_BYTES` (default: `4194304` = 4 MB)
- `REQUIRE_TOKEN` (`true` or `false`, default: `false`)
- `API_TOKEN` (required only if `REQUIRE_TOKEN=true`)

Example secure-ish LAN setup:

```bash
REQUIRE_TOKEN=true API_TOKEN='change-me' npm start
```

Then set the same token in the app's `API Token` field.

## Docker (Single Container)

Build:

```bash
docker build -t emergency-contacts-qr .
```

Run:

```bash
docker run -d \
  --name emergency-contacts-qr \
  -p 8080:8080 \
  -e REQUIRE_TOKEN=true \
  -e API_TOKEN='change-me' \
  -v $(pwd)/data:/app/data \
  emergency-contacts-qr
```

Data persists in `./data` via bind mount.

## Raspberry Pi Notes

- Keep the service LAN-only unless protected by HTTPS + auth.
- If internet-exposed, place behind reverse proxy TLS (Nginx/Caddy/Traefik).
- For always-on process outside Docker, use `systemd`.

## Data Shape

```json
{
  "meta": { "version": "1.0", "schema_version": 1, "updated_at": "ISO8601" },
  "contacts": [
    { "id": "string", "name": "string", "phone": "string", "created_at": "ISO8601" }
  ],
  "qrcodes": [
    { "id": "string", "label": "string", "upi_id": "string", "data": "data-url|https-url|/uploads/...", "created_at": "ISO8601" }
  ]
}
```

## API

- `GET /api/v1/health`
- `GET /api/v1/data`
- `POST /api/v1/data` with body `{ meta, contacts, qrcodes, mode: "merge"|"overwrite" }`
- `POST /api/v1/upload` with body `{ dataUrl: "data:image/...;base64,...", fileName?: "qr.png" }`

Auth headers (if token mode enabled):

- `x-api-token: <token>`
- or `Authorization: Bearer <token>`

## Security Notes

- Local-only mode stores data in browser `localStorage` (device/browser specific).
- Public hosting without auth exposes personal data.

## Validation

Run syntax checks:

```bash
npm run check
```
