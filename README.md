# OpsHub — House Party Distro

Internal operations management platform for production, receiving, and shipping.

## Setup

### 1. Supabase Database

1. Open your Supabase project at https://supabase.com
2. Go to **SQL Editor**
3. Run `supabase/migrations/001_initial_schema.sql`
4. Then run `supabase/migrations/002_rls.sql`

### 2. Create your first user

1. In Supabase go to **Authentication > Users**
2. Click **Add user** and create your account
3. Go to **Table Editor > profiles**
4. Find your user and set `role` to `manager`

### 3. Environment Variables (Vercel)

In your Vercel project, add these environment variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://mzkdmvvfqudpzyikafjs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

### 4. Deploy

Push to GitHub. Vercel auto-deploys on every push.

## Stack

- **Next.js 15** (App Router)
- **Supabase** (Postgres, Auth, RLS)
- **Tailwind CSS**
- **Vercel** (hosting)

## Phases

- **Phase 1 (current):** Core job management, items, decorator assignments, auth
- **Phase 2:** Department views, file uploads
- **Phase 3:** Alert engine, QB/ShipStation integrations, realtime
- **Phase 4:** Client portal
