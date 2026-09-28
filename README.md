# Luke's Dose Compass

A phone-first offline web app that helps Rikki care for Luke, an older Weimaraner in end-of-life care.

**Live:** https://rikkikkir.github.io/luke-dose-compass/

## Milestone 0 — what is here

One screen and a crisis card: who to call, in what order, and the signs that mean call now. The whole card renders from plain markup, so the page works with no network and with no JavaScript.

- **Offline.** A service worker precaches the app shell. Verified in Safari's engine with the server killed outright, not merely simulated.
- **Correctable.** Phone numbers live in `contacts.json`, which is fetched network-first. A corrected number reaches the phone the next time it has signal, without waiting on a new release.
- **Honest.** Every number carries how it was verified. Numbers nobody could confirm are kept off the main list, with the reason.

## Running the tests

```
npm install
npx playwright install chromium webkit
npm test     # integrity checks
npm run e2e  # offline and no-JavaScript behaviour, in WebKit and Chromium
```

`npm test` guards the three ways this app can silently break: a version mismatch between the page and the service worker, a file added without being precached, and the emergency number in the service worker's last-resort fallback drifting from the real one.

## Not in this repository

The working brief, Luke's medical facts, and the vet questions stay on Rikki's Mac. This repository holds code only.

## Note on the content

The urgent-signs list is a draft that has not yet been reviewed by a veterinarian, and the app says so on screen. Nothing here is veterinary advice.
