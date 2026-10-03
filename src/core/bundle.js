// Export bundle layout:
//   manifest.json, snapshot/<module>.json, raw/<module>.json (optional), README.txt
import { createZipCompressed } from './zip.js';
import { redactSnapshot } from './redact.js';

const json = (v) => JSON.stringify(v, null, 2);
const compact = (v) => JSON.stringify(v); // raw responses are for machines: no indentation

// raw/ is opt-in: snapshot/ is the contract; raw only helps re-processing and bug reports (~3x larger).
// redact: literal filter values replaced (core/redact.js); raw/ is then never included (it holds the originals).
// extraFiles: additional files the caller wants in the zip.
export function bundleFiles({ manifest, raw, snapshot }, { includeRaw = false, redact = false, extraFiles = [] } = {}) {
  const withRaw = includeRaw && !redact;
  const parts = redact ? redactSnapshot(snapshot) : snapshot;
  const files = [{ name: 'manifest.json', data: json({ ...manifest, redacted: redact }) }];
  for (const [name, part] of Object.entries(parts)) files.push({ name: `snapshot/${name}.json`, data: json(part) });
  if (withRaw) for (const [name, data] of Object.entries(raw)) files.push({ name: `raw/${name}.json`, data: compact(data) });
  files.push(...extraFiles);
  files.push({ name: 'README.txt', data: readme(manifest, withRaw, redact) });
  return files;
}

// DEFLATE-compressed zip (STORE fallback where CompressionStream is unavailable).
export async function bundleZip(collected, opts) {
  return createZipCompressed(bundleFiles(collected, opts));
}

/**
 * File name: d360-<org>-<dataSpace>-<YYYYMMDD-HHmm>.zip, where <org> is the My Domain name (readable:
 * "acme", "acme--uat", "acme-dev-ed") cut to 30 characters, or the org id when the instance URL is
 * unknown. The full org id is always in manifest.json.
 */
export function bundleName(manifest, date = new Date(), instanceUrl = null) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const org = myDomainName(instanceUrl) || String(manifest?.source?.orgId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 15) || 'org';
  const ds = String(manifest?.source?.dataSpace ?? 'default').replace(/[^A-Za-z0-9_-]/g, '_');
  return `d360-${org}-${ds}-${stamp}.zip`;
}

const MAX_ORG_NAME = 30;
/** Host "acme--uat.sandbox.my.salesforce.com" -> "acme--uat"; a non-Salesforce or unparsable URL -> "". */
export function myDomainName(instanceUrl) {
  let host;
  try { host = new URL(instanceUrl).hostname.toLowerCase(); } catch { return ''; }
  if (!/\.(my\.salesforce\.com|my\.salesforce-setup\.com|lightning\.force\.com)$/.test(host)) return '';
  return host.split('.')[0].replace(/[^a-z0-9-]/g, '').slice(0, MAX_ORG_NAME).replace(/-+$/, '');
}

function readme(manifest, includeRaw, redact) {
  const lines = [
    'Data 360 configuration export',
    '',
    `Org: ${manifest?.source?.orgId ?? 'unknown'}   API: v${manifest?.source?.apiVersion ?? '?'}   Data space: ${manifest?.source?.dataSpace ?? 'default'}`,
    `Created: ${manifest?.createdAt ?? ''}   Schema: ${manifest?.schemaVersion ?? ''}   Bundle: ${manifest?.bundleVersion ?? ''}`,
    '',
    'manifest.json      modules, request counts, errors, item counts, cross-module warnings',
    'snapshot/*.json    normalized configuration per module (the documented contract)',
    includeRaw ? 'raw/*.json         raw API responses (re-normalize later without calling the API)' : 'raw/               not included in this export',
    '',
    redact
      ? 'Filter values, static activation data and SQL literals are redacted (<redacted>).'
      : 'Filter values, static activation data and SQL literals are included as configured. Use "Redact filter values" before sharing outside your team.',
    'Contains configuration metadata only (no customer records). It may include org-specific names and IDs.',
  ];
  return lines.join('\n') + '\n';
}
