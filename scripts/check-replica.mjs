import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const replica = path.join(project, 'replica');
const output = path.join(replica, 'public');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(path.join(replica, 'vendor/source-manifest.json'), 'utf8'));
const prepared = JSON.parse(await readFile(path.join(replica, 'prepared-manifest.json'), 'utf8'));
const content = JSON.parse(await readFile(path.join(replica, 'content.json'), 'utf8'));
assert.ok(['reference-demo', 'personalised-draft', 'public-static'].includes(content.mode), 'A supported static mode is required.');
assert.equal(prepared.mode, content.mode, 'Prepared mode differs from the central content configuration.');
assert.equal(prepared.rsvpDelivery, content.rsvp?.enabled ? 'same-origin-api' : false, 'RSVP integration metadata must match the central configuration.');
assert.equal(prepared.rsvpEndpoint, content.rsvp?.enabled ? '/api/rsvp' : null, 'Only the approved same-origin RSVP endpoint is allowed.');
assert.equal(prepared.wishesDelivery, false, 'A preview must not claim wishes delivery.');
assert.equal(hash(await readFile(path.join(replica, 'vendor/source-manifest.json'))), prepared.sourceManifestSha256, 'Source manifest changed; run prepare-replica first.');
assert.equal(hash(await readFile(path.join(replica, 'content.json'))), prepared.contentSha256, 'Content changed; run prepare-replica first.');
const patches = new Map(prepared.patches.map((entry) => [entry.file, entry]));
for (const entry of manifest.files) {
  if (entry.path === 'frame.html') continue;
  const patch = patches.get(entry.path);
  if (patch) assert.equal(patch.sourceSha256, entry.sha256, entry.path);
  assert.equal(hash(await readFile(path.join(output, entry.path))), patch?.preparedSha256 || entry.sha256, `Prepared bytes differ: ${entry.path}`);
}
if (content.mode === 'public-static') {
  const icon = prepared.localAssets?.find((asset) => asset.file === 'invitation-icon-sj.svg');
  assert.ok(icon && icon.source === 'assets/invitation-icon-sj.svg', 'The public invitation needs its original local favicon.');
  assert.equal(hash(await readFile(path.join(replica, icon.source))), icon.sha256, 'Favicon source changed; rebuild first.');
  assert.equal(hash(await readFile(path.join(output, icon.file))), icon.sha256, 'Prepared favicon differs from its source.');
}
process.stdout.write(execFileSync(process.execPath, [path.join(replica, 'verify-content.mjs')], { cwd: project, encoding: 'utf8' }));

const references = new Map();
const origin = content.mode === 'public-static' && content.site.origin ? new URL(content.site.origin).origin : 'https://replica.invalid';
function reference(value, source) {
  if (!value || /^(?:data:|blob:|#)/.test(value)) return;
  const url = new URL(value.replace(/&amp;/g, '&'), origin + source);
  if (url.origin !== origin) throw new Error(`Non-local automatic asset in ${source}: ${url.href}`);
  const filename = decodeURIComponent(url.pathname);
  if (!references.has(filename)) references.set(filename, new Set());
  references.get(filename).add(source);
}
const html = await readFile(path.join(output, 'index.html'), 'utf8');
if (content.content.music?.enabled) {
  reference(content.content.music.src, '/replica-content.js');
  const asset = prepared.localAssets.find(entry => '/' + entry.file === content.content.music.src);
  assert.ok(asset, 'Enabled music must be part of the verified local assets.');
  assert.equal(hash(await readFile(path.join(replica, asset.source))), asset.sha256, 'Audio source changed; rebuild first.');
  assert.equal(hash(await readFile(path.join(output, asset.file))), asset.sha256, 'Prepared audio differs from its source.');
}
assert.equal(html, await readFile(path.join(output, 'template-frame/royal-gateway/index.html'), 'utf8'));
for (const tag of html.matchAll(/<(?:script|link|img|source)\b[^>]*>/gi)) {
  if (/\brel="canonical"/.test(tag[0])) continue;
  for (const attribute of tag[0].matchAll(/\b(?:src|href)="([^"]+)"/g)) reference(attribute[1], '/index.html');
}
for (const meta of html.matchAll(/<meta\b[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/g)) reference(meta[1], '/index.html');
if (content.mode === 'public-static') assert.ok(references.has('/invitation-icon-sj.svg'), 'Favicon must be declared as a local head dependency.');
const cssFiles = manifest.files.filter((entry) => entry.path.endsWith('.css'));
for (const entry of cssFiles) {
  const css = await readFile(path.join(output, entry.path), 'utf8');
  for (const url of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) reference(url[1] ?? url[2] ?? url[3], '/' + entry.path);
}
if (content.mode !== 'public-static') {
  const webmanifest = JSON.parse(await readFile(path.join(output, 'manifest.webmanifest'), 'utf8'));
  for (const icon of webmanifest.icons || []) reference(icon.src, '/manifest.webmanifest');
}
assert.ok((await stat(path.join(output, '404.html'))).isFile(), 'Top-level 404.html prevents a static host from treating missing assets as the app.');

const templatePath = '_next/static/chunks/3631-5fdc183989e4f7ad.js';
const template = await readFile(path.join(output, templatePath), 'utf8');
for (const asset of template.matchAll(/"([a-z][a-z0-9/-]*\.(?:webp|png|jpg))"/g)) reference('/templates/royal-gateway/' + asset[1], '/' + templatePath);
// These two names are assembled from gender in the unchanged source helper.
for (const asset of ['family-man.webp', 'family-woman.webp']) reference('/templates/royal-gateway/' + asset, '/' + templatePath);
reference('/image/Logo.webp', '/_next/static/chunks/3558-eb103990f9f205f6.js');
for (const event of content.content.events || []) {
  if (event.icon === '/varmala.svg') reference(event.icon, '/replica-content.js');
}

const runtime = await readFile(path.join(output, '_next/static/chunks/webpack-0902174dd482db0a.js'), 'utf8');
const preview = await readFile(path.join(output, '_next/static/chunks/9322-759e5fa3db2b25d6.js'), 'utf8');
const lazy = preview.match(/"royal-gateway":\(0,o.default\)\(\(\)=>Promise\.all\(\[([^\]]+)\]\)\.then\(t.bind\(t,13631\)\)/);
assert.ok(lazy, 'Cannot identify the pinned Royal Gateway lazy dependency list.');
const lazyIds = new Set([...lazy[1].matchAll(/t\.e\((\d+)\)/g)].map((match) => match[1]));
const shared = await readFile(path.join(output, '_next/static/chunks/3558-eb103990f9f205f6.js'), 'utf8');
for (const dependency of shared.matchAll(/\bn\.e\((\d+)\)/g)) lazyIds.add(dependency[1]);
const cssChunkMap = runtime.slice(runtime.indexOf('h.miniCssF='), runtime.indexOf('h.g='));
for (const id of lazyIds) {
  // 9697 is explicitly excluded by the pinned runtime's JS loader: CSS only.
  if (id === '9697') {
    const found = cssChunkMap.match(new RegExp(`${id}:"([a-f0-9]+)"`));
    assert.ok(found, `Missing CSS chunk mapping ${id}`);
    reference('/_next/static/css/' + found[1] + '.css', '/webpack lazy CSS');
    continue;
  }
  const named = runtime.match(new RegExp(`${id}===e\\?"(static/chunks/[^"]+\\.js)"`));
  const hashed = runtime.match(new RegExp(`${id}:"([a-f0-9]+)"`));
  assert.ok(named || hashed, `Missing JS chunk mapping ${id}`);
  reference('/_next/' + (named ? named[1] : `static/chunks/${id}.${hashed[1]}.js`), '/webpack lazy JavaScript');
}
const missing = [];
for (const [resource, sources] of references) {
  try { assert.ok((await stat(path.join(output, resource))).isFile()); }
  catch { missing.push(`${resource} (from ${[...sources].join(', ')})`); }
}
assert.equal(missing.length, 0, 'Missing local dependencies:\n' + missing.join('\n'));

const categories = { images: 0, fonts: 0, javascript: 0, css: 0, other: 0 };
let fileCount = 0;
async function measure(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) { await measure(filename); continue; }
    const extension = path.extname(item.name).toLowerCase();
    const category = /\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/.test(extension) ? 'images' : /\.(?:woff2?|ttf|otf)$/.test(extension) ? 'fonts' : /\.(?:m?js)$/.test(extension) ? 'javascript' : extension === '.css' ? 'css' : 'other';
    categories[category] += (await stat(filename)).size;
    fileCount++;
  }
}
await measure(output);
const total = Object.values(categories).reduce((sum, bytes) => sum + bytes, 0);
console.log(`PASS: ${references.size} distinct local dependencies, including every declared font and the lazy scratch confetti chunk.`);
console.log(`Prepared payload: ${fileCount} files, ${(total / 1024 / 1024).toFixed(2)} MiB raw (${Object.entries(categories).map(([name, bytes]) => `${name} ${(bytes / 1024).toFixed(0)} KiB`).join('; ')}). This is the complete tree, not a measured first-page transfer.`);

const urlIndex = process.argv.indexOf('--url');
if (urlIndex !== -1) {
  const base = new URL(process.argv[urlIndex + 1]);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Use a plain HTTP(S) base URL without credentials.');
  if (content.mode === 'public-static' && base.protocol === 'https:') {
    assert.ok(content.site.origin, 'Set site.origin to the deployed HTTPS origin and rebuild before production verification.');
    assert.equal(new URL(content.site.origin).origin, base.origin, 'Production URL must match site.origin so canonical and sharing metadata identify this deployment.');
  }
  for (const [resource, expected] of [['/', html], ['/replica-content.js', await readFile(path.join(output, 'replica-content.js'), 'utf8')]]) {
    const response = await fetch(new URL(resource, base), { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, `${resource}: HTTP ${response.status}`);
    assert.equal(new URL(response.url).origin, base.origin, `${resource}: unexpected redirect to a different origin`);
    assert.equal(await response.text(), expected, `${resource}: served bytes do not match the prepared invitation; rebuild or redeploy before handoff.`);
  }
  const paths = ['/', '/template-frame/royal-gateway', ...references.keys()];
  for (const resource of paths) {
    const response = await fetch(new URL(resource, base), { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, `${resource}: HTTP ${response.status}`);
    const mime = response.headers.get('content-type') || '';
    if (/\.m?js$/.test(resource)) assert.match(mime, /(?:java|ecma)script/, resource);
    if (/\.css$/.test(resource)) assert.match(mime, /text\/css/, resource);
    if (/\.woff2$/.test(resource)) assert.match(mime, /font\/woff2/, resource);
    if (/\.svg$/.test(resource)) assert.match(mime, /image\/svg\+xml/, resource);
  }
  const api = await fetch(new URL('/api/backend/public/invite/preview/rsvp', base), { method: 'HEAD', signal: AbortSignal.timeout(10000) });
  assert.ok(api.status >= 400, 'A static invitation must not expose an RSVP API route.');
  if (content.rsvp?.enabled) {
    const rsvp = await fetch(new URL(content.rsvp.endpoint, base), { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    assert.equal(rsvp.status,405,'The RSVP endpoint must exist and reject non-POST requests.');
    assert.equal(rsvp.headers.get('allow'),'POST','The RSVP endpoint must advertise only POST.');
    console.log('PASS: same-origin RSVP route rejects non-POST methods. Real storage/email delivery was not exercised by this read-only check.');
  }
  const missing = await fetch(new URL('/__replica_missing_asset_check__.js', base), { method: 'HEAD', signal: AbortSignal.timeout(10000) });
  assert.equal(missing.status, 404, 'A missing asset must return HTTP 404 rather than the invitation HTML.');
  console.log(`PASS: served HTML/content identity, ${paths.length} HTTP resources/routes, static API rejection and missing-asset 404 at ${base.origin}.`);
} else console.log('HTTP/browser checks were not run. Add --url http://127.0.0.1:4175 for optional server verification.');
