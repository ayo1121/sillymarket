# Full Stack Audit Overview

## 1. Mental Model & Architecture

### Core Components
- **Solana Program (Anchor)**: Source of truth for Markets, Positions, and outcome resolution.
- **Node.js Server (`server/`)**:
  - **Auth**: Manages SIWS (Sign-In With Solana) and sessions.
  - **Data**: Stores User profiles in `public.users` table. Stores Comments in `public.comments` table.
  - **API**: Exposes endpoints for Auth, User metadata, and Comments.
- **Supabase (Postgres)**:
  - **Storage**: Used for market image uploads.
  - **Tables**:
    - `public.users`: Created/Managed by Node.js Server. **Canonical User Data**.
    - `public.profiles`: Legacy/Supabase Auth table. **Likely Stale/Unused by Server**.
    - `public.markets`: Metadata for markets (question, image). Read by Frontend.
    - `public.bets`: Indexed from on-chain events. Read by Frontend for history/charts.
- **Frontend (React/Vite)**:
  - **Data Fetching**:
    - **Markets/Positions**: Directly from Solana RPC (via `read.ts`).
    - **User Auth/Comments**: Via Node.js Server API (`/me`, `/comments`).
    - **Market Metadata**: Via Supabase Client (`markets` table).
    - **Bet History**: Via Supabase Client (`bets` table).
    - **User Profiles**: **INCONSISTENT**. Reads from `profiles` table directly.

### Data Flow & Sources of Truth

| Concept | Canonical Source | Read By | Write By | Inconsistencies |
| :--- | :--- | :--- | :--- | :--- |
| **Users** | `public.users` (Server) | Server API, Comments | Server (SIWS) | `UserProfile.tsx` and `markets.ts` read `public.profiles`. |
| **Markets** | On-chain (Logic) + `public.markets` (Meta) | Frontend (`read.ts`) | Program + Server/Indexer | `markets.ts` joins with `profiles` for creator names. |
| **Bets** | On-chain `Position` | `MyBets`, `UserProfile` | Program | `UserProfile` enriches with `public.bets` for Tx Links. `MyBets` does not. |
| **Comments** | `public.comments` (Server) | Frontend (`CommentsSection`) | Server API | Consistent (uses `users` table). |

## 2. Key Inconsistencies & Risks

### Critical: User Data Model Split
- **Server** uses `public.users`.
- **Frontend** (`UserProfile`, `markets.ts`) uses `public.profiles`.
- **Risk**: Users signing in via SIWS populate `users`, but their profile page and market creator labels look at `profiles`, which may be empty or stale.

### Important: Feature Gaps
- **MyBets**: Lacks transaction links (available in `UserProfile`).
- **Loading States**: Inconsistent across pages (Spinners vs Skeletons).

## 3. Security
- **RLS**:
  - `public.users`: Needs RLS to allow public read (for profiles) but restrict write to Server.
  - `public.comments`: Managed by Server, but if exposed to Supabase Client, needs RLS.
  - `public.markets`: Read-only for Anon.

## 4. Performance
- **RPC**: `fetchMarketsBatch` effectively reduces calls.
- **API**: Comments polling (5s) is simple but effective.
