import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {replicaHeaders} from './replica-policy.mjs';

const prepared = spawnSync(process.execPath, ['scripts/prepare-replica.mjs'], {stdio: 'inherit'});
if (prepared.status !== 0) process.exit(prepared.status || 1);
const html = await readFile('replica/public/index.html', 'utf8');
const config = JSON.parse(await readFile('replica/content.json', 'utf8'));
// All source/configuration validation happens in prepare before replacing build output.
await rm('dist-replica', {recursive: true, force: true});
await mkdir('dist-replica', {recursive: true});
await cp('replica/public', 'dist-replica', {recursive: true});
const headers = replicaHeaders(html);
await writeFile('dist-replica/_headers', '/*\n' + Object.entries(headers).map(([key, val]) => `  ${key}: ${val}`).join('\n') + '\n');
await writeFile('dist-replica/robots.txt', 'User-agent: *\nDisallow: /\n');
if (config.rsvp?.enabled) {
  if (config.rsvp.googleForm) {
    const handler=await readFile('backend/google-form-worker.mjs','utf8');
    await writeFile('dist-replica/_worker.js',handler+'\nconst form='+JSON.stringify(config.rsvp.googleForm)+';\nexport default {fetch(request,env,ctx){if(new URL(request.url).pathname!=="/api/rsvp")return env.ASSETS.fetch(request);const delivery=handleGoogleFormRsvp(request,form);ctx.waitUntil(delivery.then(()=>undefined));return delivery;}};\n');
  } else await cp('backend/rsvp-worker.mjs', 'dist-replica/_worker.js');
  await writeFile('dist-replica/_routes.json', JSON.stringify({version: 1, include: ['/api/rsvp'], exclude: []}, null, 2) + '\n');
  console.log(config.rsvp.googleForm ? 'Google Forms RSVP relay included.' : 'RSVP Worker included. Configure encrypted bindings before publishing.');
}
console.log(config.mode === 'public-static' ? 'Invitation built in dist-replica/.' : 'Local invitation preview built in dist-replica/. This is not a guest publication.');
