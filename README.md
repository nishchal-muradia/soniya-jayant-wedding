# Soniya & Jayant wedding invitation

Private source for the Murdiya family’s invitation. Wedding: 4 December 2026. Celebrations: 2–4 December at Dhariwal Stadium, Kanor, Udaipur, Rajasthan. Soniya appears first throughout.

## Local preview

Use Node.js 24. No dependency installation is required.

```sh
npm run dev
```

Open http://127.0.0.1:4175/.

## Build and verify

```sh
npm run build
npm run check
npm test
```

The deployable output is `dist-replica/`. Generated output is excluded from Git. The build verifies the original source snapshot before generating the site.

## Cloudflare Pages: connect GitHub

Create a Pages project using this private GitHub repository. Use:

- Production branch: `main`
- Framework preset: None
- Build command: `npm run build && npm run check && npm test`
- Build output directory: `dist-replica`
- Root directory: repository root
- Node version: 24 (also specified in `.nvmrc`)

The build includes `_worker.js` and `_routes.json` for direct RSVP submissions. Deploy the complete output so `/api/rsvp` works. The Google Form adapter does not need an API token. The production origin is `https://soniya-jayant-wedding.pages.dev`.

Pushing commits to `main` updates the site once Cloudflare Git integration is connected. Check the live page and submit a clearly identified test response before sharing the link. Automated tests use mocked Google responses; they do not prove live delivery.

## Editing

- `replica/content.json`: invitation text, programme, contacts, music, and form mapping.
- `scripts/prepare-replica.mjs`: presentation changes applied to the verified template.
- `replica/music-player.js`: music controls and browser autoplay fallback.
- `backend/google-form-worker.mjs`: direct RSVP relay.

RSVP collects name, attendance and optional blessings. It stays on the invitation, showing success only after Google returns a recorded-response confirmation. The relay uses the public form's submission endpoint; changes to Google Form fields or confirmation text may require updating the adapter. Retry coalescing is temporary and is not a durable exactly-once guarantee.

Music uses the original Jashn-e-Bahaaraa flute recording, preloads and attempts autoplay. Browsers may require the first tap before audible playback.

## Source and assets

Keep this repository private. The invitation includes supplied family contact information and licensed/template assets. See `replica/SOURCE_PERMISSION.md`, `replica/assets/MUSIC.md`, and retained font licences under `replica/vendor/licenses/`. Original template files remain unchanged so their hashes can be verified. The prepared site is generated from the supplied invitation configuration.

## Programme and family

The programme is transcribed from the supplied invitation images. The midnight wedding is displayed under 4 December with the note “Wedding”; its calendar instant is 5 December at 00:00 IST. The countdown targets Ganpati Sthapana on 2 December at 07:30 IST. The same venue is used for all events.

The new Google Form is https://forms.gle/W6LzpmEwA2RWXfZ97. The field mapping was read from that form on 5 November 2026; no test responses were sent.

This is an independent project copied from the existing invitation. It has no connection to the earlier invitation’s repository or Cloudflare deployment. Source repository: https://github.com/nishchal-muradia/soniya-jayant-wedding (private). Production site: https://soniya-jayant-wedding.pages.dev.
