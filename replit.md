# PulseFit

PulseFit is a Portuguese-language fitness app for managing training plans, schedules, exercises, and user profiles through an existing REST API.

## Run & Operate

- `pnpm --filter @workspace/pulsefit run dev` — run the PulseFit frontend
- `pnpm --filter @workspace/pulsefit run typecheck` — check the frontend types
- `pnpm run typecheck` — full typecheck across all packages
- Optional frontend env: `VITE_API_BASE_URL` — upstream REST API base URL. Defaults to the temporary ngrok URL supplied for this app.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + TypeScript
- Upstream REST API: existing Java/Spring Boot service; frontend sends `ngrok-skip-browser-warning: true`
- Session: browser localStorage, without storing the returned password
- PulseFit does not own a backend, database, or business logic

## Where things live

- `artifacts/pulsefit/src/App.tsx` — application screens and navigation
- `artifacts/pulsefit/src/lib/api.ts` — upstream API requests, response types, and local session
- `artifacts/pulsefit/src/index.css` — PulseFit theme and responsive styles

## Architecture decisions

- Do not add a PulseFit backend or database; all business logic and stored data belong to the existing Spring Boot API.
- Do not fetch exercise content from third-party APIs; use the upstream API's exercise endpoints and videos.
- Keep the upstream API base configurable because the provided ngrok URL is temporary.

## Product

Users can sign in or register, complete beginner onboarding, browse their workouts and exercises, schedule and complete sessions, and view their profile.

## User preferences

Use the existing API as the single source of truth for accounts, questionnaires, training plans, exercises, and schedules.

## Gotchas

- Every upstream API request must include `ngrok-skip-browser-warning: true`.
- The temporary ngrok URL may be offline or change; update `VITE_API_BASE_URL` when the tunnel changes.
- CORS on the upstream API must allow the frontend origin and the custom ngrok warning header.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
