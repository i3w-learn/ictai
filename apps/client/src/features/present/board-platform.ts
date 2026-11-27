import type { Platform } from '../../platform/platform';

// The platform as the board window may use it. The board window is a guest in the console's app:
// it reads the saved settings and fetches files, but it never changes what the console owns. It
// does not save or wipe settings, does not say whose files are fetched (the console has), does not
// keep a show alive (the console does) and does not lock the app down.
export function boardPlatform(p: Platform): Platform {
  return {
    appVersion: p.appVersion,
    discover: (app) => p.discover(app),
    request: (req) => p.request(req),
    probe: (baseUrl) => p.probe(baseUrl),
    loadSettings: () => p.loadSettings(),
    saveSettings: async () => undefined,
    clearSettings: async () => undefined,
    relayOpen: (baseUrl, certFp, token) => p.relayOpen(baseUrl, certFp, token),
    relaySend: (text) => p.relaySend(text),
    relayClose: () => p.relayClose(),
    onRelay: (listener) => p.onRelay(listener),
    fileUrl: p.fileUrl && ((hash) => p.fileUrl!(hash)),
    present: p.present,
    installRole: () => p.installRole(),
  };
}
