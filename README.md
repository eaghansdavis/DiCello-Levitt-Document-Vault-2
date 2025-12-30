# DiCello-Levitt Document Vault

This repository hosts a Next.js (App Router) prototype for the Vault + Review Table workflow. The app runs entirely client-side with in-memory state persisted to `localStorage`—no backend or authentication are required.

## Getting started
1. `cd frontend`
2. Install dependencies with `pnpm install` (preferred) or `npm install`.
3. Start the development server via `pnpm dev`.
4. Navigate through the stages: Upload → Vault → Select → Columns → Run → Table → Export.

## Repo structure
- `frontend/` – Next.js client implementation.
- `backend/` – Placeholder for future APIs.
- `AGENTS.md` – Contributor guidance.

Remember to run `npm test` (currently a placeholder) after modifying JavaScript/TypeScript files.
