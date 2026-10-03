# Config Snapshot for Salesforce Data 360 – Privacy

**Summary: the extension reads your Data 360 configuration from your own Salesforce org and saves it as a file on your computer. Nothing is sent anywhere else.**

## What the extension accesses

- **The URL of the active tab**, only on Salesforce domains (`*.lightning.force.com`, `*.my.salesforce.com`, `*.my.salesforce-setup.com`), to know which org you are looking at.
- **Your Salesforce session cookie (`sid`)** for that org's My Domain, to call the Salesforce REST API as you. The cookie is read when you open the panel and before each export. It is kept only in the panel's memory and is never stored, logged or transmitted to anyone other than your Salesforce org.
- **Configuration metadata** from Salesforce APIs (read-only GET requests): data model objects and fields, data streams, mappings, segments, activations, calculated insights, identity resolution rules and data graphs. The extension does not request customer records.

## What the extension does not do

- It does not send data to the developer or any third party. There is no analytics, telemetry or remote code.
- It does not modify anything in your org (GET requests only).
- It does not read pages, forms or other websites.

## Where your data goes

The export is built in the browser and downloaded as a `.zip` file to your computer. What you do with that file is up to you. It may contain org-specific names and IDs, and literal values used in segment or activation filters. The **Redact filter values** option replaces those values before the file is created.

## Local storage

The panel remembers your last choices (selected modules, data space, options) in the extension's local storage. No session data is stored.

## Contact

Open an issue in the project repository.
