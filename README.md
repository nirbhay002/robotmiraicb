# Romaji AI Robot (Frontend + API Gateway)

Next.js app that serves the robot UI and acts as the gateway between the browser and backend services.

## Architecture

This service is **Service A** in a 2-service design:

- **Service A (this repo folder):** Next.js UI + internal API routes
- **Service B:** FastAPI face service (InsightFace + ChromaDB)

Browser camera/mic are used directly in the client. Backend never accesses device camera.

## Current Flow

### 1) Landing
- User chooses:
  - `Register as New User`
  - `I'm an Old User`

### 2) New User Registration
- Browser captures frame from camera
- Frame is downscaled (max `1024x1280`) and encoded as JPEG
- UI posts multipart to `POST /api/face/register`
- Next.js proxies to FastAPI `/register`
- If face already exists, backend reuses canonical identity (`registration_mode: "existing"`)
- UI transitions to chat with canonical backend name

### 3) Old User Recognition
- Browser starts 10-second scan loop (~400ms interval)
- Each tick uploads downscaled frame to `POST /api/face/identify`
- On first match:
  - stop polling
  - stop camera tracks
  - show `Join Chat`
- If no match after 10s:
  - stop polling/camera
  - return to landing

### 4) Voice Conversation (Realtime)
- `Join Chat` tap is required (iPad autoplay-safe gesture)
- Client requests `POST /api/realtime/session`
- Client opens WebRTC to OpenAI Realtime model:
  - `gpt-realtime-mini-2025-12-15`
- Bot gives warm first greeting automatically
- Multi-turn context is retained while this connection stays open
- On `End Chat`, connection is closed and context is discarded

## API Routes (Next.js)

- `POST /api/face/register`
  - Input: multipart (`name`, `file`)
  - Proxy target: `${FACE_API_BASE}/register`
- `POST /api/face/identify`
  - Input: multipart (`file`)
  - Proxy target: `${FACE_API_BASE}/identify`
- `POST /api/realtime/session`
  - Creates Realtime session bootstrap using server `OPENAI_API_KEY`
  - Returns model + ephemeral client secret
- `POST /api/chat`
  - Legacy route kept in repo, not used by primary Realtime flow

## Face Registration Dedup Rule

Backend uses **face-first identity**:

- On register, nearest existing embedding is checked first
- If within threshold (`COSINE_DISTANCE_THRESHOLD`), existing user is reused
- Canonical/original stored name is kept
- Response includes:
  - `registration_mode: "existing" | "new"`

This prevents same person being stored under multiple names.

## Environment Variables

Create `frontend-and-llm-calls/.env.local`:

```env
OPENAI_API_KEY=your_openai_api_key
FACE_API_BASE=http://localhost:7000
```

Notes:
- Do not place env file in `app/`; place it at project root.
- Restart dev server after env changes.

## Local Development

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Service Dependencies

You must run the face service separately:

- folder: `image-processing-and-recognition-service`
- expected API base (default here): `http://localhost:7000`

## iPad / Browser Requirements

- Use HTTPS in deployment for camera + microphone permissions
- Realtime audio starts only after explicit user gesture (`Join Chat`)
- Camera is stopped before Realtime chat starts

## Operational Notes

- No long-term conversation persistence is implemented
- Realtime context is session-scoped (active connection only)
- Raw images are not stored by face service (embeddings + metadata only)
