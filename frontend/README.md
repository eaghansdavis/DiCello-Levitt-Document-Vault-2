# Frontend

This Next.js (App Router) client implements the Vault + Review Table workflow. Everything is in-memory with localStorage persistence—no backend is required.

## Getting started
1. Install dependencies (prefer `pnpm install`).
2. Run the development server with `pnpm dev` (or `npm run dev`).
3. Open the app, upload documents, confirm each stage, and work through the breadcrumb: Upload → Vault → Select → Columns → Run → Table → Export.

## Notes
- State (documents, schema, audit log) is saved to `localStorage` so a refresh keeps your progress.
- The “Run” stage simulates extraction only—no legal advice is provided.
- Exports include citations; the Excel export is stubbed but logged for auditing.
