# Director Mode AI

Complete tennis & racket sports platform with three integrated tools:

- **MixerMode AI** - Events, round robins, team generation, brackets
- **LastMinuteLesson** - Coaching slots, client management, email blasts  
- **StringingMode AI** - Pro shop job tracking with AI recommendations

## Tech Stack

- **Next.js 14** with App Router
- **TypeScript**
- **Supabase** (Auth + Postgres)
- **Tailwind CSS**
- **Resend** for emails
- **OpenAI/Anthropic** for AI features

## Getting Started

### 1. Clone and Install

```bash
git clone https://github.com/lazerd/DirectorModeAI.git
cd DirectorModeAI
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the contents of `supabase/schema.sql`
3. Copy your project URL and keys from Settings > API

### 3. Configure Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in your values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

RESEND_API_KEY=re_your_key
EMAIL_FROM=noreply@yourdomain.com

AI_PROVIDER=openai
AI_API_KEY=sk-your-key
AI_MODEL=gpt-4o-mini

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Homepage
│   ├── login/                # Auth pages
│   ├── register/
│   │
│   ├── mixer/                # MixerMode AI
│   │   ├── home/             # Events list
│   │   ├── events/           # Create/manage events
│   │   └── ...
│   │
│   ├── lessons/              # LastMinuteLesson
│   │   ├── dashboard/        # Calendar view
│   │   ├── clients/          # Client management
│   │   ├── blast/            # Email blasts
│   │   └── ...
│   │
│   ├── stringing/            # StringingMode AI
│   │   ├── jobs/             # Job board
│   │   ├── customers/        # Customer history
│   │   ├── catalog/          # String inventory
│   │   └── ...
│   │
│   └── api/                  # API routes
│
├── lib/
│   └── supabase/             # Supabase clients
│
└── components/               # Shared components
```

## Features

### MixerMode AI
- Create events with unique codes
- Player check-in via QR code
- Round robin team generation
- Tournament brackets
- Real-time scoring
- Event photos & results cards

### LastMinuteLesson
- Visual calendar for slots
- One-click slot creation
- Bulk email blasts to clients
- Client management with import
- Secure slot claiming
- Club & independent coach modes

### StringingMode AI
- AI-powered string recommendations
- Job board (pending/in-progress/done)
- Customer & racket history
- String catalog management
- Pickup email notifications
- Job repeat feature

## License

MIT
