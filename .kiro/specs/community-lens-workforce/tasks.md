# Implementation Plan

- [ ] 1. Set up project structure, environment, and database
  - Create the full folder structure: `/frontend`, `/backend/gateway`, `/backend/services/*`, `/backend/shared`, `/database/migrations`, `/database/seeds`
  - Create `.env.example` with all required variables: DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, GROQ_API_KEY, OPAY_PUBLIC_KEY, OPAY_SECRET_KEY, OPAY_BASE_URL, GATEWAY_PORT, all service ports, NEXT_PUBLIC_API_URL
  - Write PostgreSQL migration files for all 17 tables: users, companies, skills, assessments, skill_scores, jobs, applications, contracts, milestones, payments, trust_scores, reviews, portfolio, resources, subscriptions, disputes
  - Write a seed file for the `skills` table with common skill categories (Frontend, Backend, Design, Writing, Data, etc.)
  - _Requirements: all_

- [ ] 2. Build shared backend utilities
- [ ] 2.1 Implement shared middleware and config
  - Write JWT utility (sign, verify) in `backend/shared/utils/jwt.ts`
  - Write bcrypt password utility (hash, compare) in `backend/shared/utils/password.ts`
  - Write standard error response helper returning `{ success: false, error: { code, message } }`
  - Write database connection pool using `pg` in `backend/shared/config/db.ts`
  - _Requirements: 10.1, 10.2_

- [ ] 2.2 Implement skill level mapping function
  - Write `scoreToLevel(score: number): number` in `backend/shared/utils/skillLevel.ts` mapping 0–20→0, 21–40→1, 41–60→2, 61–80→3, 81–100→4
  - _Requirements: 2.3_

- [ ]* 2.3 Write property test for skill level mapping (Property 1)
  - Use `fast-check` to generate integers in [0, 100] and assert `scoreToLevel` returns the correct level for all inputs with no undefined results
  - Tag: `// **Feature: community-lens-workforce, Property 1: Skill Level is a deterministic function of Skill Score**`
  - **Validates: Requirements 2.3**

- [ ] 2.4 Implement trust score formula function
  - Write `computeTrustScore({ completion_rate, on_time_rate, avg_rating, disputes_count })` in `backend/shared/utils/trustScore.ts`
  - Formula: `(completion_rate × 0.40) + (on_time_rate × 0.25) + ((avg_rating / 5 × 100) × 0.25) + (disputes_count === 0 ? 10 : 0)`
  - _Requirements: 5.1, 5.2_

- [ ]* 2.5 Write property test for trust score formula (Property 2)
  - Use `fast-check` to generate valid rate/rating combinations, assert result is in [0, 100] and matches formula exactly
  - Tag: `// **Feature: community-lens-workforce, Property 2: Trust Score is bounded and formula-consistent**`
  - **Validates: Requirements 5.1, 5.2**

- [ ] 3. Build User Service (port 3002)
- [ ] 3.1 Implement auth routes: register and login
  - POST /auth/register — validate input, hash password with bcrypt, insert into `users`, if role=company also insert into `companies`, return JWT
  - POST /auth/login — verify email/password, return JWT
  - POST /auth/logout — invalidate token (blacklist in memory or DB flag)
  - _Requirements: 1.5, 10.1_

- [ ] 3.2 Implement user profile routes
  - GET /users/:id — return user profile joined with company data if applicable
  - PUT /users/:id — update allowed fields (full_name, phone, location, bio, avatar_url), enforce JWT ownership
  - POST /users/:id/avatar — accept multipart upload, save to local storage, update avatar_url
  - _Requirements: 6.1, 10.1_

- [ ] 3.3 Implement portfolio routes
  - GET /users/:id/portfolio — return all portfolio rows for user
  - POST /users/:id/portfolio — insert portfolio item, enforce JWT ownership
  - _Requirements: 6.2, 6.3_

- [ ] 4. Build API Gateway (port 3001)
  - Set up Express with `http-proxy-middleware` to route by path prefix to each service
  - Add JWT verification middleware on all routes except /auth/register and /auth/login
  - Add rate limiting: 10 req/min on /auth/*, 100 req/min on everything else
  - Add CORS for frontend origin
  - Add error handler returning standard envelope for 401, 429, 502
  - _Requirements: 10.1, 10.2_

- [ ] 5. Build Skill Service (port 3003)
- [ ] 5.1 Implement skill and assessment routes
  - GET /skills — list all from `skills` table
  - GET /skills/:id — single skill
  - POST /assessments — insert assessment row with status `submitted`, call AI Service to evaluate, update score and status
  - GET /assessments/:userId — list assessments for user
  - _Requirements: 2.1, 2.2_

- [ ] 5.2 Implement skill score routes with Worker write protection
  - GET /skill-scores/:userId — return all skill_scores for user
  - PUT /skill-scores/:userId/:skillId — only callable internally (no Worker JWT accepted); update score and call `scoreToLevel` to set level; emit notification event if level boundary crossed
  - Enforce: if JWT role is `worker` and userId matches token sub, return 403
  - _Requirements: 2.3, 2.4, 2.5, 2.6_

- [ ]* 5.3 Write property test for Skill Score immutability (Property 4)
  - Use `fast-check` to generate Worker JWTs and skill_score update requests, assert all return 403
  - Tag: `// **Feature: community-lens-workforce, Property 4: Skill Score is immutable by the Worker**`
  - **Validates: Requirements 2.6**

- [ ] 6. Build Job Service (port 3004)
- [ ] 6.1 Implement job posting routes
  - POST /jobs — validate budget >= minimum threshold (enforce Req 3.5), insert job, trigger AI Service match score computation for eligible workers
  - GET /jobs — list open jobs with optional skill/budget filters
  - GET /jobs/:id, PUT /jobs/:id, DELETE /jobs/:id (cancel)
  - _Requirements: 3.1, 3.5_

- [ ] 6.2 Implement application routes
  - POST /jobs/:id/apply — check Worker trust_score >= 40 if job requires Level 2+ (Req 5.5); check is_verified for Level 2+ (Req 10.1); insert application; call AI Service for match score
  - GET /jobs/:id/applications — return applications ranked by ai_match_score descending
  - PUT /applications/:id — accept or reject; on accept trigger contract creation
  - _Requirements: 3.2, 3.3, 5.5, 10.1_

- [ ]* 6.3 Write property test for match score ordering (Property 5)
  - Use `fast-check` to generate pairs of worker profiles where A has higher skill + equal/higher trust than B, assert A match score >= B match score
  - Tag: `// **Feature: community-lens-workforce, Property 5: Match Score inputs are monotonically contributing**`
  - **Validates: Requirements 3.3**

- [ ] 6.4 Implement contract and milestone routes
  - POST /contracts — create contract, immediately call Payment Service to lock escrow (Req 4.1); set status `active` only after payment confirmed held
  - GET /contracts/:id — contract detail with milestones
  - POST /contracts/:id/milestones — add milestone
  - PUT /milestones/:id — update status; on status=`submitted` notify Client; on status=`approved` call Payment Service release
  - _Requirements: 3.4, 4.1, 4.2, 4.3_

- [ ]* 6.5 Write property test for escrow lock precedes work (Property 3)
  - Use `fast-check` to generate contract creation sequences, assert no contract has status `active` without a corresponding `held` payment record
  - Tag: `// **Feature: community-lens-workforce, Property 3: Escrow lock precedes work**`
  - **Validates: Requirements 4.1, 3.4**

- [ ] 6.6 Implement dispute routes
  - POST /disputes — Worker raises dispute on rejected milestone within 48h; insert to `disputes` table; notify both parties; assign to moderator
  - GET /disputes/:id — dispute detail
  - PUT /disputes/:id/resolve — moderator resolves; update dispute status; call Payment Service for escrow outcome; call Trust Service to apply penalty to losing party
  - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 7. Build Trust Service (port 3005)
- [ ] 7.1 Implement trust score routes
  - GET /trust/:userId — return trust_scores row
  - POST /reviews — insert review; call recalculate
  - GET /reviews/:userId — list all reviews for user
  - PUT /trust/:userId/recalculate — recompute using `computeTrustScore` from all reviews and contract data; update trust_scores row
  - _Requirements: 5.1, 5.2, 5.3, 5.6_

- [ ]* 7.2 Write property test for trust score idempotence (Property 7)
  - Use `fast-check` to generate user trust data, call recalculate twice with no intervening changes, assert both results are equal
  - Tag: `// **Feature: community-lens-workforce, Property 7: Trust Score recalculation is idempotent**`
  - **Validates: Requirements 5.6**

- [ ]* 7.3 Write property test for dispute count monotonicity (Property 9)
  - Use `fast-check` to simulate sequences of dispute raises, assert disputes_count never decreases
  - Tag: `// **Feature: community-lens-workforce, Property 9: Dispute count accumulation monotonicity**`
  - **Validates: Requirements 9.5, 5.3**

- [ ] 8. Build Payment Service (port 3006)
- [ ] 8.1 Implement escrow initiation and verification
  - POST /payments/initiate — call OPay API to create payment, insert payment row with status `held` and opay_reference
  - POST /payments/verify — handle OPay webhook/callback; verify signature using OPAY_SECRET_KEY; update payment status
  - _Requirements: 4.1, 4.6_

- [ ] 8.2 Implement payment release and refund
  - POST /payments/release — transition payment from `held` to `released`; deduct Platform Fee; record full transaction details (timestamp, amount, fee, parties)
  - POST /payments/refund — transition payment from `held` to `refunded`; call OPay refund endpoint
  - GET /payments/history/:userId — return all payment records for user
  - _Requirements: 4.3, 4.5_

- [ ]* 8.3 Write property test for payment release reduces escrow balance (Property 6)
  - Use `fast-check` to generate milestone approval events, assert payment transitions held→released and sum of held payments decreases by exactly milestone amount
  - Tag: `// **Feature: community-lens-workforce, Property 6: Payment release reduces escrow balance**`
  - **Validates: Requirements 4.3, 4.5**

- [ ] 9. Build AI Service (port 3007)
- [ ] 9.1 Implement Groq client and prompt utilities
  - Set up OpenAI-compatible Groq client using GROQ_API_KEY and base URL `https://api.groq.com/openai/v1`, model `llama3-8b-8192`
  - Write input sanitization function to strip prompt injection patterns before sending to Groq
  - Write token-limit truncation with warning log
  - _Requirements: 1.1, 10.2_

- [ ] 9.2 Implement AI onboarding and assessment endpoints
  - POST /ai/onboard — sanitize input, send onboarding prompt, parse response into structured profile object `{ skills, levels, location, recommendedPath, suitableJobTypes }`, return JSON
  - POST /ai/assess — send assessment prompt for skill evaluation, parse score (0–100) and feedback from response, return `{ score, feedback }`
  - _Requirements: 1.1, 2.1, 2.2_

- [ ]* 9.3 Write property test for AI profile round-trip consistency (Property 8)
  - Use `fast-check` to generate structured profile objects, serialize to JSON and deserialize, assert deep equality with no fields lost
  - Tag: `// **Feature: community-lens-workforce, Property 8: AI onboarding profile round-trip consistency**`
  - **Validates: Requirements 1.1**

- [ ] 9.4 Implement AI matching, chat, and resource endpoints
  - POST /ai/match — build prompt from worker profile + job details, parse match score (0–100) and explanation, return `{ score, explanation }`
  - POST /ai/chat — career guidance chat with conversation history support
  - POST /ai/resources — identify hardship signals in message, filter `resources` table by Worker location, return matching resources
  - _Requirements: 3.3, 7.1, 7.2_

- [ ] 10. Checkpoint — ensure all backend services pass their tests
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Build Next.js frontend foundation
- [ ] 11.1 Initialize Next.js 14 app with Tailwind CSS
  - Set up `frontend/` with App Router, Tailwind config, global styles
  - Create `frontend/lib/api.ts` — typed fetch wrapper pointing to `NEXT_PUBLIC_API_URL`
  - Create `frontend/lib/auth.ts` — JWT storage (httpOnly cookie preferred) and session helpers
  - _Requirements: all frontend_

- [ ] 11.2 Build shared UI components
  - `TrustScoreBadge` — circular score 0–100 with red/yellow/green color bands
  - `SkillLevelBadge` — shows Level 0–4 with label (New/Basic/Verified/Professional/Expert)
  - `JobCard` — title, budget, required skills, AI match %
  - `WorkerCard` — name, trust score, top skills, availability
  - `MilestoneTracker` — contract progress steps
  - `EscrowStatus` — held/released/refunded indicator
  - `ResourceCard` — community resource with category icon
  - _Requirements: 5.4, 6.1, 3.2_

- [ ] 12. Build authentication pages
  - `/register` — role selector (worker/company); worker flow includes AI onboarding chat; company flow collects company profile; calls POST /auth/register
  - `/login` — email + password form; calls POST /auth/login; stores JWT
  - _Requirements: 1.1, 1.5_

- [ ] 13. Build Worker pages
- [ ] 13.1 Implement Worker dashboard
  - `/dashboard` — display Trust Score badge, active contracts, recent earnings, skill levels grid, floating AI chat widget
  - _Requirements: 5.4, 6.1_

- [ ] 13.2 Implement Jobs browsing and application
  - `/jobs` — list open jobs with skill/budget filter; show AI match % per job for logged-in Worker
  - `/jobs/[id]` — job detail, company reputation, apply button (enforces trust score and verification gates)
  - _Requirements: 3.1, 3.2, 5.5, 10.1_

- [ ] 13.3 Implement Worker profile (Digital Work Passport)
  - `/profile` — full Digital Work Passport: verified skills with levels, Trust Score, job history, portfolio, shareable public URL
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 13.4 Implement Assessment page
  - `/assessment` — list available skill assessments; task display + submission form; show AI feedback and resulting Skill Score after evaluation
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 13.5 Implement Wallet and Resources pages
  - `/wallet` — earnings summary, payment history, OPay payout trigger
  - `/resources` — community resources filtered by Worker location, category tabs (training/food/health/opportunity)
  - _Requirements: 4.3, 7.1, 7.2_

- [ ] 14. Build Company pages
- [ ] 14.1 Implement Company dashboard and job management
  - `/company/dashboard` — posted jobs, active contracts, trust score
  - `/company/jobs/new` — job posting form with skill selector, budget, duration; triggers AI matching on submit
  - `/company/jobs/[id]` — manage job, view ranked applications, accept/reject workers
  - _Requirements: 3.1, 3.2, 3.5_

- [ ] 14.2 Implement Contract management
  - `/company/contracts/[id]` — milestone tracker, approve/reject milestone submissions, escrow status, release payment button
  - _Requirements: 4.2, 4.3, 4.4_

- [ ] 15. Build AI Chat page and Settings
  - `/chat` — full-page AI career guidance chat using POST /ai/chat
  - `/settings` — account settings, Pro Membership subscription management, notification preferences
  - _Requirements: 8.1, 8.2, 8.4, 8.5_

- [ ]* 15.1 Write property test for Pro Membership skill score isolation (Property 10)
  - Use `fast-check` to generate Worker subscription activations, query skill_scores before and after, assert no change
  - Tag: `// **Feature: community-lens-workforce, Property 10: Pro Membership does not alter Skill Score**`
  - **Validates: Requirements 8.3**

- [ ] 16. Final Checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
