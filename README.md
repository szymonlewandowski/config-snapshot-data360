# Config Snapshot for Salesforce Data 360

A Chrome extension that takes a **read-only snapshot of a Salesforce Data 360 (Data Cloud) org's configuration** and downloads it as one `.zip` of normalized JSON: data model, data streams, mappings, segments, activations, calculated insights, identity resolution and data graphs.

Use it to document an org, review a configuration, or compare the state of an org over time. It runs entirely in your browser on your existing Salesforce session: no server, no account, no data sent anywhere.

> **Beta.** Unofficial and not affiliated with Salesforce. The export format may still change (see [CHANGELOG](CHANGELOG.md)).

## What is in a snapshot

| Module | Contents | API requests |
|---|---|---|
| Data model | DMOs, fields, types, keys, active relationships | 1 |
| Data streams | Streams, connectors, DLOs, source → DLO field mappings | 2 + 1 per stream |
| DLO → DMO mappings | Field mappings per DMO | 1 per DMO |
| Segments | Definitions with the criteria parsed into a tree | 1 per 100 segments |
| Activations | Targets, attributes, contact points, filters, static data | 2 + 1 per activation |
| Calculated insights | SQL, dimensions, measures | 4 |
| Identity resolution | Match and reconciliation rules, run statistics | 1 |
| Data graphs | Object trees, joins, recency, refresh schedule | 1 + 1 per graph |

A typical org takes a few dozen requests and seconds to a minute. The panel shows the estimate before you export.

The zip holds `manifest.json`, `snapshot/<module>.json` and a `README.txt`, plus optionally the raw API responses. The format is documented in [docs/export-format.md](docs/export-format.md).

## Install

**From a release (beta):**
1. Download `config-snapshot-for-d360-<version>.zip` from [Releases](../../releases) and unzip it somewhere permanent.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the unzipped folder.
3. Pin the extension (puzzle icon → pin).

To update, replace the folder's contents with the new version and click the reload arrow on the extension's card.

**Chrome Web Store:** coming later.

Requirements: Chrome 116+, an org with Data 360 enabled, and a user with API access to the Data 360 configuration.

## Use

1. Open your org in a tab (Lightning, Setup or the My Domain URL).
2. Click the extension icon. The side panel shows the org, the user, the API version and the remaining daily API requests.
3. Pick a data space and the modules, then click **Export**. The file `d360-<org>-<dataSpace>-<date>.zip` lands in your Downloads.

Options:
- **Redact filter values** replaces literal values in segment and activation filters, static activation data and SQL with `<redacted>`. Objects, fields and logic stay. Use it before sharing a snapshot outside your team.
- **Include raw API responses** adds the original responses (about 3× larger), useful for bug reports.

## Permissions and privacy

| Permission | Why |
|---|---|
| `sidePanel` | The UI is a side panel next to Salesforce. |
| `cookies` | Reads your Salesforce session cookie (`sid`) for the org in the active tab, to call the Salesforce API as you. |
| Hosts `*.my.salesforce.com`, `*.lightning.force.com`, `*.my.salesforce-setup.com` | Recognising the org in the active tab and calling its API. |

The extension sends **only GET requests**, only to your own org. The session cookie is kept in the panel's memory and is never stored or logged. There is no analytics or remote code. Snapshots contain configuration metadata, not customer records. Details: [PRIVACY.md](PRIVACY.md).

## Known limitations

- One snapshot covers **one data space**.
- Some segments return no criteria through the API (for example some nested segments and segments using vector search operators). The snapshot marks them; it does not guess.
- Formula (transform) mappings are not available through this API.
- No record counts or segment populations, only identity resolution statistics.
- Response shapes are verified on API v67.0. The extension uses at most the tested version.

## Development

Node 20+ is needed for development only; there are no dependencies to install.

```bash
npm test            # unit and end-to-end tests against a synthetic org, plus package checks
npm run serve       # the panel in a normal browser tab against the synthetic org: http://localhost:8360/
npm run build       # dist/extension/ (Load unpacked) and dist/config-snapshot-for-d360-<version>.zip
npm run icons       # regenerate the toolbar icons
npm run load-test   # export a synthetic org with 2,500 extra objects
```

During development you can also load `src/` directly with **Load unpacked**.

Harness parameters (add to the URL): `?expired=1`, `?nosid=1`, `?tab=none`, `?fail=<module>`, `?latency=400`, `?scale=500`.

```
src/                 the extension
  manifest.json
  background.js      opens the side panel
  panel/             UI (HTML, CSS, controller)
  lib/               browser adapter (cookies, tabs, downloads)
  core/              export engine: Salesforce client, modules, normalization, zip, redaction (plain JS)
dev/                 harness: fake browser platform and a local server (not shipped)
test/                tests and the synthetic org fixture
scripts/             build, icons, load test
docs/                export format, API notes
store/               Chrome Web Store listing texts
```

`src/core/` uses neither Node nor browser-specific APIs: it gets `fetch` and the session token from the caller, which is why the same code runs in the extension and in the tests.

## Releasing

1. Bump the version in `src/manifest.json` (`version`, and `version_name` while in beta) and `package.json`, and add a section to `CHANGELOG.md`. A test checks they match.
2. Commit, then tag and push: `git tag v0.1.1 && git push origin v0.1.1`.
3. The release workflow runs the tests, builds the zip and publishes a GitHub release with it attached.

## License

[EUPL-1.2](LICENSE). Author: [Szymon Lewandowski](https://szymonlewandowski.pl).

Salesforce, Data 360 and Data Cloud are trademarks of Salesforce, Inc. This project is not affiliated with or endorsed by Salesforce.
