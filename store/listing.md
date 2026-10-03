# Chrome Web Store listing

Texts for the store submission. Keep them in sync with the README and PRIVACY.md.

## Name
Config Snapshot for Salesforce Data 360

## Summary (max 132 characters)
Read-only snapshot of your Salesforce Data 360 (Data Cloud) configuration: data model, streams, mappings, segments – as JSON.

## Category
Developer Tools

## Description
Take a read-only snapshot of a Salesforce Data 360 (Data Cloud) org's configuration and download it as one zip of normalized JSON.

What the snapshot contains:
• Data model: objects, fields, types, keys, relationships
• Data streams, data lake objects and source field mappings
• DLO → DMO field mappings
• Segments, with their criteria parsed into a readable tree
• Activations: targets, attributes, contact points, filters
• Calculated insights, identity resolution rules, data graphs

Use it to document an org, review a configuration or compare an org over time.

How it works: open your org, click the extension icon, pick a data space and the modules, click Export. The extension uses your existing Salesforce session, sends read-only (GET) requests to your own org only, and builds the file in your browser. Nothing is sent to the developer or any third party. An option replaces literal filter values before you share a snapshot.

Unofficial; not affiliated with Salesforce. Salesforce, Data 360 and Data Cloud are trademarks of Salesforce, Inc.

## Single purpose
Export the configuration of the Salesforce Data 360 org open in the active tab to a local file.

## Permission justifications
- **sidePanel:** the extension's UI is a side panel shown next to Salesforce.
- **cookies:** reads the Salesforce session cookie (`sid`) of the org in the active tab, so the extension can call that org's REST API as the signed-in user. The cookie stays in memory and is never stored or transmitted elsewhere.
- **Host permissions (`*.my.salesforce.com`, `*.lightning.force.com`, `*.my.salesforce-setup.com`):** recognise the Salesforce org in the active tab and call its API. No other sites are accessed.
- **Remote code:** none. All code is in the package.

## Data usage disclosure
The extension does not collect or transmit user data. Configuration read from the user's own org is saved only as a local file.

## Privacy policy URL
TBD (publish PRIVACY.md at a public URL before submitting).

## Assets to prepare
- Icon 128×128: `src/icons/icon128.png`
- Screenshots 1280×800 (from the harness, synthetic org only)
- Small promo tile 440×280 (optional)
