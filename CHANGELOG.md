# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-03

First beta.

### Added
- Side panel that detects the Salesforce org in the active tab and shows the user, API version and remaining daily API requests.
- Snapshot modules: data model, data streams, DLO → DMO mappings, segments (criteria parsed into a tree), activations, calculated insights, identity resolution, data graphs.
- Data space selection, request estimate, parallel requests with a global limit, timeouts and retries.
- Export as one zip: `manifest.json`, `snapshot/<module>.json`, `README.txt`; export format schema 0.5.
- Options: redact filter values; include raw API responses.
- File name `d360-<My Domain>-<dataSpace>-<date>.zip`.
