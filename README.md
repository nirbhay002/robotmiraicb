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
- Browser starts 10-second scan loop with adaptive cadence based on prior request latency
- Client enforces foreground checks before upload when browser `FaceDetector` is available:
  - single face, centered, large enough, non-blurry
- Each valid tick uploads a smaller downscaled frame to `POST /api/face/identify`
- Recognition requires temporal confirmation (same `user_id` appearing across recent frames)
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
  - `gpt-realtime-2025-08-28`
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
  - Uses shared Mirai-first policy instructions from `app/lib/miraiPolicy.ts`
  - Returns model + ephemeral client secret
- `POST /api/chat`
  - Shares the same policy from `app/lib/miraiPolicy.ts`
  - Kept as text fallback/policy reference route

## Mirai Policy

- Canonical policy source: `app/lib/miraiPolicy.ts`
- Realtime (`/api/realtime/session`) and text (`/api/chat`) both use the same policy behavior.
- `Mirai`, `MSOT`, and `Mirai School of Technology` are treated as the same institution.
- Mirai-specific answers are grounded in verified facts.
- College comparisons are Mirai-first (promotional with positive framing, no fabricated attacks/claims).
- General education/career questions are answered normally.
- Non-education topics are declined and redirected to education/Mirai context.
- Unknown Mirai specifics are marked as unverified and routed to official MSOT channels.

## Policy Regression Fixture

- Script: `scripts/verify-mirai-policy.ts`
- Purpose: lightweight checks for alias handling, Mirai known facts, Mirai-first comparisons, general education scope, off-topic refusal, unknown-specific handling, and hallucination guard patterns.
- Run from `frontend-and-llm-calls`:

```bash
npx tsx scripts/verify-mirai-policy.ts
```

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
NEXT_PUBLIC_REALTIME_VAD_THRESHOLD=0.72
NEXT_PUBLIC_REALTIME_VAD_PREFIX_PADDING_MS=300
NEXT_PUBLIC_REALTIME_VAD_SILENCE_DURATION_MS=900
```

Notes:
- Do not place env file in `app/`; place it at project root.
- Restart dev server after env changes.
- In noisier spaces, increase `NEXT_PUBLIC_REALTIME_VAD_THRESHOLD` (for example: `0.78`) to reduce background-triggered turns.

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
