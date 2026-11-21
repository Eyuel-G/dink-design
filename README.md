# Dink Design

Describe a factory, shop, or room. Dink lays it out in 3D and prices a bill of quantities. Marketplace links appear only when a listing was actually parsed and its host matches the source. Everything else stays a labeled estimate.

The 3D models are dimension-fit stand-ins, not manufacturer models. A reference photo, when you have one, is shown beside the stand-in.

## Run locally

```bash
npm install
npm run models
npm run dev
```

Open http://127.0.0.1:3847.

Copy `.env.example` to `.env.local` if you want a model key or MySQL. Without `ANTHROPIC_API_KEY`, common prompts use built-in layouts. Without `MYSQL_URL` or `DATABASE_URL`, projects live in memory for the server process and a banner says so.

MySQL 8 is the only database. Apply the schema by starting the app once with `MYSQL_URL` set; migrations in `db/migrations` run on connect. Do not point this app at Postgres.

```bash
npm test
npm run typecheck
npm run lint
```

## How a prompt becomes a room

1. The planner returns a catalog spec. It never writes coordinates.
2. Layout and cost are pure functions. The same spec always yields the same geometry and totals.
3. Assets resolve from the local GLB library, then a procedural block. Online fetch and AI generation are attempted only when those services are configured, and a failure keeps the stand-in.
4. Estimates show immediately. A price check may upgrade a line to a verified listing.

Jiji Ethiopia is seeded as a source. If the site answers with a bot challenge, the source is marked Blocked and the estimate stays, with no link.

## Scripts

- `npm run dev` — Next.js on port 3847
- `npm run models` — rebuild the Draco stand-in GLBs in `public/catalog`
- `npm test` — layout, cost, link, and version tests
