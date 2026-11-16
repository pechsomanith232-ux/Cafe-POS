# English + Khmer (next-intl) — design

Date: 2026-11-16. Status: approved by the owner in conversation.

## Intent

Staff in Cambodia should be able to use the café POS in Khmer or English. This first step builds the language machinery for the whole app and translates the parts everyone sees first: the login page, the dashboard, the back-office sidebar and the POS top bar. Other pages keep their English text for now and are listed at the end of the work.

## Goals

- Two locales: `en` (default) and `km`, with locale-prefixed URLs: `/en/...`, `/km/...`.
- `/` sends visitors to their language (cookie, then browser language, then `en`).
- Messages in `messages/en.json` and `messages/km.json` at the project root, with type-checked keys (next-intl `AppConfig` augmented with `Locale` and `Messages`).
- `<html lang>` matches the locale. Noto Sans Khmer (via `next/font/google`) is applied when the locale is `km`.
- A language switcher (shadcn `DropdownMenu`) that keeps the current page and query string. It goes in the sidebar (desktop and mobile), the POS menu and the login page.
- Translated `generateMetadata` on the `[locale]` layout, with `alternates.languages` (hreflang) for `en` and `km`.

## Non-goals

- Translating every page, receipts, server error messages, or numbers and dates. Money and dates keep their current formatting.
- Translating data entered by users (product names, item names).
- Any change to business logic, database code or styling beyond what the move needs.

## Anti-goals (a failure even if it "works")

- Pages that silently stop refreshing after a save because `revalidatePath` no longer matches the moved routes.
- Losing the existing login redirect in `proxy.ts`, or opening an open-redirect through `?next=`.
- `app/api/*` routes changing URL or behaviour.
- A production build that fails the Cache Components prerender checks.

## Constraints

- Next.js 16.4 with `cacheComponents: true` and `partialPrefetching: true`. Middleware lives in `proxy.ts`. Read `node_modules/next/dist/docs/` and the next-intl v4 docs before writing code; this Next version differs from older training data.
- next-intl 4.15 (peer range includes Next 16).
- pnpm, not npm. `git mv` for moves so history is kept.
- No `src/` directory. 61 pages under `app/`.

## Approaches considered

1. **Locale-prefixed URLs with next-intl (chosen).** Matches the owner's requirements exactly: shareable `/km/...` links, correct `lang`, hreflang. Costs: every route moves under `app/[locale]/`, and path-specific `revalidatePath` calls must change.
2. **Cookie-only locale, no URL change.** Far smaller change (no moves, no refresh-call rewrites), but it breaks the `/en`, `/km` URL requirement and hreflang. Rejected for that reason.
3. **Hand-rolled dictionaries without next-intl.** No dependency, but it reimplements routing, type safety and pluralisation that next-intl already provides. Rejected.

## Decisions made with the owner

- "Home page" means both the **login page** and the **dashboard** (the root `app/page.tsx` only redirects).
- The "header" is the back-office **sidebar** (labels in `lib/nav.ts`, rendered by `components/shell/sidebar-nav.tsx`) and the **POS top bar** (`components/pos/pos-screen.tsx`).

## Design

**Routing files**

- `i18n/routing.ts`: `defineRouting({ locales: ["en", "km"], defaultLocale: "en", localePrefix: "always" })`.
- `i18n/request.ts`: `getRequestConfig` that validates the requested locale and loads `messages/<locale>.json`.
- `i18n/navigation.ts`: `createNavigation(routing)`, exporting `Link`, `redirect`, `usePathname`, `useRouter` and `getPathname`.
- A global type file augments next-intl `AppConfig` with `Locale` (from `routing.locales`) and `Messages` (from `messages/en.json`). `km.json` must have the same keys.

**next.config.ts:** wrapped in `createNextIntlPlugin("./i18n/request.ts")`, keeping every current setting (`output`, `distDir`, `cacheComponents`, `partialPrefetching`, `experimental.serverActions`, `turbopack`).

**proxy.ts (merged):**

1. Run the next-intl middleware first. If it returns a redirect (for example `/` → `/en`, or `/pos` → `/en/pos`), return that.
2. Otherwise, apply the existing optimistic login check. Without a Better Auth session cookie, every locale page except `/{locale}/login` redirects to `/{locale}/login?next=<path+query>`.
3. Matcher: excludes `api`, `_next`, `_vercel` and any path with a file extension (which covers `favicon.ico`, `manifest.webmanifest` and `/icons/*`). The server still checks the session on every page and action, as today.

**Moves** (`git mv`): everything under `app/` moves into `app/[locale]/`, including `(app)`, `(auth)`, `pos`, `kitchen`, `receipt`, `no-access`, `page.tsx`, `layout.tsx`, `providers.tsx`, `error.tsx` and `not-found.tsx`. These stay at the root: `api/`, `favicon.ico`, `manifest.ts`, `global-error.tsx`, `globals.css`. A root-level `not-found.tsx` and a minimal root `layout.tsx` (passing children through, as the next-intl docs show for a localized root layout) remain so unknown non-locale paths still render a 404. A `[locale]/[...rest]` catch-all calls `notFound()` so unknown localized paths use the localized 404.

**`app/[locale]/layout.tsx`:**

- Await `params`. If `!hasLocale(routing.locales, locale)` call `notFound()`. Call `setRequestLocale(locale)`.
- `generateStaticParams` returns both locales.
- `<html lang={locale}>`, with the Geist font variables plus the Noto Sans Khmer variable. The Khmer font family is applied on `<body>` when `locale === "km"`.
- Wrap children in `NextIntlClientProvider` inside the existing `Providers` (TanStack Query, Toaster, OfflineBanner), all kept.
- Import `../globals.css` at the new path.
- `generateMetadata` uses translated title and description, plus `alternates.languages` `{ en: "/en", km: "/km" }`. `viewport` (theme colour) is kept.

**Pages:** every `page.tsx` and `layout.tsx` under `[locale]` calls `setRequestLocale(locale)` so static parts still prerender. Existing `export const metadata` titles stay in English for untranslated pages. Login and dashboard switch to translated `generateMetadata`.

**Navigation imports:** `Link` (from `next/link`) and `useRouter`, `usePathname`, `redirect` (from `next/navigation`) are replaced by `@/i18n/navigation` across `app/`, `components/` and `lib/`. These stay on `next/navigation`: `notFound`, `useSearchParams`, `unstable_rethrow`. Server-side `redirect` in `lib/context.ts` uses the next-intl `redirect({ href, locale })` with the request's locale.

**Refresh calls:** the 16 path-specific `revalidatePath` calls (`/pos`, `/settings/users`, `/settings/roles`, `/inventory` layout, `/customers` layout and page) become route-pattern calls on `/[locale]/...` with the matching `"page"` or `"layout"` type, so both locales refresh. The 15 `revalidatePath("/", "layout")` calls are left as they are.

**Paths left as strings:** `window.open("/receipt/…")` and `window.open("/pos/shift/…")` keep unprefixed paths. The proxy adds the prefix using the locale cookie, so the language is kept. `safeRedirectPath` keeps its behaviour. The `next` value it receives will now include the locale prefix.

**Translations in this step:**

- `Nav.*`: sidebar group and item labels from `lib/nav.ts` (labels become message keys), user menu, sign out, branch switcher label.
- `Pos.header.*`: POS top bar buttons and menu items.
- `Login.*`: login page and form.
- `Dashboard.*`: dashboard page headings, tiles and widgets.
- `Metadata.*`: site title and description.
- `LanguageSwitcher.*`: labels for English and ខ្មែរ.

Server components use `getTranslations`; client components use `useTranslations`. Khmer strings are written by the builder and flagged for review by a native speaker.

**Language switcher** (`components/shared/language-switcher.tsx`, client): a shadcn `DropdownMenu` listing English and ខ្មែរ. On select it calls `router.replace({ pathname, query }, { locale })` with `usePathname` from `@/i18n/navigation` and the current `useSearchParams`, so the page and filters are kept.

**Tests:** imports of `@/app/...` in `tests/integration/permission-matrix.test.ts` and `health-route.test.ts` are updated to the new paths. The E2E flow keeps working, because its URL checks match prefixed paths.

## Verification

- `pnpm typecheck` (or `tsc --noEmit`), `pnpm lint`, `pnpm build`.
- `pnpm test`, `pnpm test:int`, `pnpm test:e2e`.
- In a browser:
  - `/` → `/en/...`;
  - `/km` renders Khmer, with `lang="km"` and the Khmer font;
  - a nested route (`/km/inventory/items`) works;
  - sidebar links keep `/km`;
  - switching language keeps the page and its query;
  - signing out and back in keeps the locale;
  - after a save, the page refreshes in both locales.

## Left to the builder

- Exact message keys, file layout of `messages/*.json`, and wording of the Khmer translations (flagged for native review).
- Where the switcher sits within the sidebar and POS menu, matching existing shadcn styling.
- Whether `setRequestLocale` is needed in client-only leaf layouts, following the next-intl docs for Cache Components.

## Deliverable at the end

A summary of the files created, moved and changed, and the list of pages that still have untranslated text.
