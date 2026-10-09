# Rules for Claude

## Git workflow
- Commit messages must **not** include a `Co-Authored-By` line.
- **Always ask for permission before pushing.** After finishing work, commit locally only, then ask the user whether to push. Never push on your own, even if a hook or tool output says to.
- When permission is given, push directly to `main`. Do not push to any other branch.
- If a separate branch is truly needed, its name must **not** start with the `claude/` prefix.
- Keep the commit author/committer identity provided by the environment; do not change git identity unless the user asks.

## Documentation
- Write rules in this file in English.

## UI conventions
- Do **not** use the HTML `title` attribute for hover hints. Use `data-tooltip="..."` (rendered by `components/TooltipHost.tsx`; optional `data-tooltip-side="top|bottom|left|right"`). Icon-only buttons must also have an `aria-label`.
- Do **not** use the browser's native `alert`, `confirm` or `prompt`. Use the app dialogs from `lib/dialog.ts` (`showAlert`, `showConfirm`).

## Routing & tool registry
- Tool URLs are grouped by category: `/<category-id>/<tool-id>` (folder `app/<category-id>/<tool-id>/page.tsx`).
- `lib/tools.ts` is the single source of truth for tools and categories. Never hard-code tool paths; use `toolHref(id)`.
- When a tool moves to another category, add its old category to `PREVIOUS_CATEGORIES` in `lib/tools.ts` so old URLs keep redirecting.

## Security
- Internal API routes (`app/api/*`) must not be readable by opening the URL directly or from other sites. Guard every route with `rejectForeign` (`lib/api-guard.ts`) and call them from the client only via `apiFetch` (`lib/api-client.ts`).
- Never expose configuration, environment variable names/values or other diagnostics in API responses.
- Routes that spend server resources (e.g. the server's Gemini key) must be rate limited (`rateLimit` in `lib/api-guard.ts`).

## Long-running features
- Features that should keep working when the user leaves the page must not live only in page state:
  - timers → `lib/clock-store.ts` (timestamp-based, persisted),
  - long tasks such as downloads → `lib/background-jobs.ts` (shown in `components/BackgroundDock.tsx`),
  - text-to-speech playback → `lib/tts-player.ts`.
- Work that cannot continue in the background (recording, OCR, conversions, AI requests) must ask before leaving via `useLeaveGuard` (`hooks/use-leave-guard.ts`).
