# 🤖 Romaji AI Robot - Redesigned Architecture

## 🎯 Overview

Clean, simple flow with two entry points:
- **New User**: Capture face → Enter name → Chat
- **Old User**: 10-second face scan → Auto-recognize → Chat

## ✨ Key Features

### 1. **Landing Page**
- Two clear buttons: "Register as New User" and "I'm an Old User"
- Simple, intuitive UI
- No confusion

### 2. **New User Registration**
- **Face Capture**: One-click image capture
- **Name Input**: Text field with Enter to submit
- **Database Save**: Face + Name stored locally
- **Instant Start**: Directly to chat after registration

### 3. **Old User Recognition**
- **10-Second Scan**: Face recognition at start only
- **Auto-Identify**: Finds user in database
- **Greeting**: "नमस्ते [Name]! मैं आपको पहचान गया हूँ।"
- **No Re-scanning**: Assumes same user throughout session

### 4. **Chat Interface**
- **Voice-based**: Speech-to-text and text-to-speech
- **Memory**: Remembers conversation (last 10 messages)
- **Knows User**: Uses recognized name in responses
- **End Chat Button**: Clears conversation, returns to landing

## 🔄 Complete User Flow

### New User Journey:
```
1. Click "Register as New User"
   ↓
2. Camera opens → Position face
   ↓
3. Click "Capture Face"
   ↓
4. Face captured → Enter name in text field
   ↓
5. Press Enter (or click Save)
   ↓
6. Saved to database → Start chatting
```

### Old User Journey:
```
1. Click "I'm an Old User"
   ↓
2. 10-second face scanning (progress bar)
   ↓
3. Face recognized → "Welcome back, [Name]!"
   ↓
4. Start chatting immediately
   
   OR
   
3. Not recognized → "Please register first"
   ↓
4. Back to landing page
```

### Chat Session:
```
1. In chat → Click "Start Speaking"
   ↓
2. Speak your message
   ↓
3. Robot processes → Responds with voice
   ↓
4. Auto-listens for next message
   ↓
5. Click "End Chat" when done
   ↓
6. Conversation cleared, back to landing
   ↓
7. Database kept intact (faces + names preserved)
```

## 📂 File Structure

```
project/
├── app/
│   ├── page.tsx                    # Landing page with 2 buttons
│   ├── components/
│   │   ├── RegistrationFlow.tsx   # New user registration
│   │   └── ChatInterface.tsx      # Main chat UI
│   ├── lib/
│   │   └── faceLogic.ts           # Face detection & recognition
│   └── api/
│       └── chat/
│           └── route.ts           # LLM chat API (simplified)
├── public/
│   └── models/                    # face-api.js models
└── .env.local                     # OpenAI API key
```

## 💾 Database Structure

```typescript
// IndexedDB: RomajiFaceDB
{
  name: "Rahul",
  descriptors: [
    [0.123, -0.456, ...], // 128 dimensions
    [0.124, -0.455, ...], // Up to 5 samples
  ],
  createdAt: 1234567890,
  updatedAt: 1234567890
}
```

## 🔑 Key Improvements

| Feature | Benefit |
|---------|---------|
| Clear Entry Points | No confusion - New vs Old user |
| 10-Second Scan Only | Faster, no continuous processing |
| Text Name Input | More reliable than voice |
| End Chat Button | Clean session management |
| Session-Based | Assumes same user per session |
| Simplified Code | Easier to maintain |

## ⚙️ Configuration

```typescript
// Recognition Settings (lib/faceLogic.ts)
const MATCH_THRESHOLD = 0.6;      // 60% confidence
const SCAN_DURATION = 10000;      // 10 seconds

// Chat Settings (api/chat/route.ts)
model: "gpt-4o-mini"
temperature: 0.7
max_tokens: 150
```

## 🚀 Setup

1. Install dependencies:
```bash
npm install face-api.js
```

2. Download face-api models to `/public/models/`

3. Add OpenAI API key to `.env.local`:
```env
OPENAI_API_KEY=your_key_here
```

4. Run the app:
```bash
npm run dev
```

## 🧪 Testing Checklist

```
✓ Landing page displays
✓ New user registration works
✓ Face capture successful
✓ Name saves to database
✓ Old user scan recognizes faces
✓ Unrecognized users rejected
✓ Chat interface functional
✓ Voice recognition works
✓ TTS works (Hindi + English)
✓ End Chat clears conversation
✓ End Chat preserves database
✓ Can re-login as old user
```

---

**Made with ❤️ at Mirai School of Technology**





















This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
