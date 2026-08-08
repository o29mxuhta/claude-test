import { orefProxy, corsPreflight } from './_proxy.js';

export async function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestGet(context) {
  return orefProxy(context, {
    // Documented path first (docs/architecture.md, docs/oref-sources.md,
    // CLAUDE.md all specify the `alert/` segment). The second entry is the
    // path this Function used previously; it is tried only on a 404 so that
    // whichever one Oref actually serves, the history feed keeps working.
    // The history feed is the only reliable source of all-clears — if it
    // breaks, locations never turn green.
    target: [
      'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json',
      'https://www.oref.org.il/WarningMessages/History/AlertsHistory.json',
    ],
    redirectSuffix: '/api2/history',
    kind: 'history',
  });
}
