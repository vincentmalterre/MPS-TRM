# MPS TRM

## Project Overview

MPS-TRM is the ERP web app for **Tricotage Malterre (TRM)**, the knitting production company of the Malterre Holding. It is the sister app of **MPS_NG** (`C:\dev\MPS_NG`, the ETS Malterre ERP) and replicates its design and architecture exactly, migrating the legacy WinDev app's "Tricotage Malterre" mode screen by screen.

- **Company**: Tricotage Malterre (TRM) — knitting production (tricotage)
- **Owner**: Vincent Malterre
- **Legacy system**: the WinDev MPS app (`C:\Mes Projets\MPS\`) in Tricotage Malterre mode (red banner), plus the older standalone `C:\Mes Projets\TRMPROD\`
- **Sister project**: MPS_NG (`C:\dev\MPS_NG`) — same design system, same conventions, same DB, same API

## Architecture — frontend-only repo, shared API and DB

**This repo contains only the web frontend.** There is deliberately no API here:

- **Database**: the shared HFSQL `MPS` database (same server as MPS_NG). Shared tables (`client`, `commande_client`, …) are partitioned by `IDsociete` — **TRM = 2** (ETM = 1, Confection = 3). Every TRM write must set `IDsociete = 2`.
- **API**: the **MPS_NG API** (`C:\dev\MPS_NG\apps\api`, dev port 8080). All HFSQL footgun-handling (encoding repair, bridge storm protection, accented columns, positional inserts) and TRM-specific logic (ETM↔TRM cross-ledger bridge, `isTricotageMalterreSst`) already live there. **New TRM endpoints get added to the MPS_NG API**, scoped `IDsociete = 2` — never build a second API stack on the shared tables.
- **Auth**: the shared cookie auth (`mps_uid`) against the same API — login/user-picker, permissions and admin gating work identically to MPS_NG.
- **Dev CORS**: this app runs on port **5175**, which is already in the MPS_NG API's `CORS_ORIGIN` list (`apps/api/.env.development`). If the port changes, update that list.

When implementing a feature here you will therefore usually touch **two repos**: the screen in `MPS-TRM/apps/web`, and its endpoints in `MPS_NG/apps/api`. All HFSQL rules from `MPS_NG/CLAUDE.md` apply to those endpoints — read them before writing any route.

## Branding

Identical to MPS_NG — same colors, same design system:

| Color | Hex | Usage |
|-------|-----|-------|
| **Primary Blue** | #143D6B | Sidebar, navigation, headers |
| **Vivid Gold** | #F2B80A | CTAs, highlights, active states |
| **Accent Blue** | #3B7DC9 | Links, alternative accent |

Full design system in `.claude/skills/mps_designer/SKILL.md` (copied from MPS_NG — MPS_NG's copy is the upstream source of truth; re-sync when it changes).

The `public/logo-*.png` files are currently the MPS_NG logos as placeholders — replace with TRM logos when available.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript 5.7, Vite 6, Tailwind CSS 3.4 |
| UI | Radix primitives (shadcn-style), Lucide icons |
| State | TanStack React Query 5 |
| Monorepo | pnpm + Turborepo (apps/web only for now) |
| API (external) | MPS_NG Express API on HFSQL — see Architecture above |

## Navigation Structure

Mirrors the legacy WinDev app in Tricotage Malterre mode (top → bottom):

1. **Tableau de bord** (`/`) — placeholder
2. **Clients** — Commandes, Expéditions, Facturation, Gestion, Planning
3. **Fils** — Références, Stock, Fournisseurs
4. **Tombé Métier** — Références, Échantillons, Stock (custom `TmRollIcon`)
5. **Production** — Gestion des OF, Visitage, Prime, TRS
6. **Atelier** — Maintenance, Productivité, Bonnetier, Quiz, Planning
7. **Qualité** — Défauts récents, Retour client, Analyse
8. **Rapports** — Production, Lots de fils, État stock fil, Analyse
9. **Paramètres** — Utilisateurs (admin-only)

All screens are `PagePlaceholder`s for now. Legacy references for each domain: `FEN_Gestion_des_OF.wdw`, `FEN_Machines.wdw`, `FEN_Rapport_de_production.wdw`, etc. in `C:\Mes Projets\TRMPROD\` and the main MPS WinDev project.

## Design system rule

**Before building or modifying any user-facing screen, component, button, tab, card, dialog, or interaction pattern, you MUST invoke the `mps_designer` skill (`Skill(skill: "mps_designer")`).** Not optional — same rule as MPS_NG.

**Before inventing a pattern, grep the MPS_NG gold-standard reference screens** (`C:\dev\MPS_NG\apps\web\src\pages\`): `Entreprises.tsx`, `FilsGestion.tsx`, `FilsStock.tsx`, `FilsCommandes.tsx`, `EtudesColoris.tsx`. Reuse the exact same icons, strings and dialog structures.

Key invariants (full detail in the skill):
- Panel backgrounds `bg-zinc-100/80` (list/sidebar) / `bg-zinc-200/50` (header/footer) / `bg-white` (cards); `scrollbar-transparent` on scrollable panels. **Never hardcode hex values.**
- OS system font stack only — **no web fonts** (`@import`/`<link>`/`@font-face` are banned in `index.css`).
- "Modifier" CTA is always `<Button variant="gold">`.
- 3-panel `MasterDetailLayout` for master-detail screens; table-centric pattern (§27) for row-list screens; unsaved-changes guard (§28) on every edit-mode screen.
- Native `<select>` is banned — use `PopoverSelect` / `SearchableCombobox`.

## React / frontend rules (inherited from MPS_NG)

- **Hooks before early returns** — violating crashes production builds (React error #310).
- **Shared `apiFetch`** (`src/lib/api.ts`) for every API call — sets `credentials: 'include'` for cookie auth. Never duplicate per page.
- **SW denylist for `/api/`** in `vite.config.ts` — never remove.
- **Never revert web build to `tsc -b`** — emitted `.js` in `src/` shadows `.tsx` sources in Vite. Build is `tsc --noEmit && vite build`.
- HFSQL booleans are `0`/`1` — always `!!value &&` in JSX to avoid rendering `0`.

## Conventions

- **Code**: English. **UI**: French. **Comments**: English.
- **"check last screenshot"** → read the latest file in `%USERPROFILE%\Pictures\Screenshots`.
- Git remote: `github.com/vincentmalterre/MPS-TRM` (vincentmalterre account).

## Quick Start

```bash
pnpm install
pnpm dev          # web on http://localhost:5175

# The MPS_NG API must be running (dev port 8080):
#   cd C:\dev\MPS_NG && pnpm dev
```

## Business Domain (Quick Reference)

Same glossary as MPS_NG (`C:\dev\MPS_NG\claude_doc\business_glossary.md`).

| French | English |
|--------|---------|
| Tricotage | Knitting |
| Métier | Knitting machine |
| OF (Ordre de fabrication) | Production order |
| Tombé métier | Greige fabric off the machine |
| Visitage | Piece inspection |
| Bonnetier | Knitter (machine operator) |
| Fonture | Needle bed |
| Jauge | Gauge |
