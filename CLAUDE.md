# Role: Matrix Architecture & Knowledge Engine

## System Data Flow
- **Immutable Knowledge Inputs:** `docs/**/*.md`, `backend/app/`, `backend/database/schema.sql`, `frontend/`, `z-matrix-design-system/`, `Matrix_dev/00_Sources/`
- **Holding Zone:** `Matrix_dev/inbox/`
- **LLM Managed Vault (Wiki Root):** `Matrix_dev/`
- **Project Memory Protocol:** `Matrix_dev/claude.md` — **READ THIS FIRST every session.** It defines folder access rules, the Tombstone Protocol, the Change_BL workflow, and the Dataview dashboard. All operations below must comply with it.

## Session Bootstrap (MANDATORY)
Before initiating any work:
1. Read `Matrix_dev/claude.md` (memory protocol).
2. Read `Matrix_dev/Dashboard.md` to see current `active` and `pending_review` state.
3. Read `Matrix_dev/INDEX.md` for the vault map.
4. Honor folder access rules: `00_Assets/` is gated by its index; `00_Sources/` requires explicit user invocation.

## Operations & Automation Rules

### 1. `/map-codebase`
- Scan the `frontend/` components, `z-matrix-design-system/` configurations, `backend/app/` logic, and `backend/database/schema.sql`.
- Generate and continuously sync detailed architectural map files inside:
  - `Matrix_dev/02_Data_&_State/` (Schema & query mappings)
  - `Matrix_dev/05_Frontend_Architecture/` (Layouts, routes, global state flows)
  - `Matrix_dev/06_Design_System/` (Design tokens and UI components)
- Interlink code elements, state schemas, and API contracts using explicit Obsidian `[[Wikilinks]]`.
- All created/updated files MUST carry the YAML frontmatter defined in `Matrix_dev/claude.md`.

### 2. `/ingest`
- Scan for any raw architectural notes, feature requests, or messy thoughts dropped inside `Matrix_dev/inbox/`.
- Convert dense articles or feature logs into clean, single-focus markdown files inside `Matrix_dev/01_Business_Domains/`.
- Move the processed raw text file from `Matrix_dev/inbox/` into `Matrix_dev/00_Sources/` for permanent archival tracking.
- Cross-reference newly introduced domains back to the technical implementation folders.

### 3. `/lint-wiki`
- Use the `obsidian-markdown` and `obsidian-bases` skills to sweep through all markdown files inside `Matrix_dev/`.
- Repair broken internal wikilinks, identify disconnected "orphan" pages, and ensure Frontmatter YAML metadata blocks at the top of the files are structured perfectly.
- Validate that every file conforms to the YAML schema in `Matrix_dev/claude.md`. Flag non-conformers as `status: pending_review`.

## End-of-Session Rule
At the end of every significant session: update the wiki timeline, refresh `last_updated` on touched files, apply the Tombstone Protocol to redundant files, and confirm `Matrix_dev/Dashboard.md` still renders the three required tables.
