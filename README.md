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

## Install on Ubuntu (Raspberry Pi 4) with Docker Compose

1. Install Docker + Compose plugin:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

2. Clone repo:

```bash
cd ~
git clone https://github.com/gajjartejas/emergency-contacts-qr.git
cd emergency-contacts-qr
```

3. Prepare config and persistent data:

```bash
cp .env.example .env
mkdir -p data/uploads
```

4. (Optional) Edit `.env` to enable token auth:

```bash
nano .env
```

Use:

```env
APP_PORT=9000
REQUIRE_TOKEN=true
API_TOKEN=change-this-to-a-long-random-token
```

5. Build and start:

```bash
docker compose up -d --build
```

6. Verify:

```bash
docker compose ps
curl http://127.0.0.1:9000/api/v1/health
```

Open:

```text
http://<pi-ip>:9000
```

7. Daily operations:

```bash
docker compose logs -f
docker compose restart
docker compose pull   # if using prebuilt image in future
docker compose up -d --build
docker compose down
```

Data persists in `./data` (bind-mounted into `/app/data`).

## Docker (Without Compose)

```bash
docker build -t emergency-contacts-qr .
docker run -d \
  --name emergency-contacts-qr \
  --restart unless-stopped \
  -p 9000:8080 \
  -v $(pwd)/data:/app/data \
  emergency-contacts-qr
```

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
