import { readFile, writeFile, mkdir, copyFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const replica = path.join(project, 'replica');
const vendor = path.join(replica, 'vendor');
const output = path.join(replica, 'public');
const staging = path.join(replica, '.public-preparing');
const manifest = JSON.parse(await readFile(path.join(vendor, 'source-manifest.json'), 'utf8'));
const config = JSON.parse(await readFile(path.join(replica, 'content.json'), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Original platform APIs remain blocked by preview mode. An explicitly enabled
// RSVP submits only to this invitation's same-origin backend.
const publicMode = config.mode === 'public-static';
if (config.schemaVersion !== 1 || config.template !== 'royal-gateway' || !['reference-demo', 'personalised-draft', 'public-static'].includes(config.mode)) {
  throw new Error('Replica content must remain schemaVersion 1, royal-gateway, and a supported static mode.');
}
const allowed = new Set(['schemaVersion', 'template', 'mode', 'content', 'settings', 'wishes', 'site', 'rsvp']);
for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`Unsupported replica configuration key: ${key}`);
if (!isObject(config.content) || !isObject(config.settings) || !Array.isArray(config.wishes)) throw new Error('Replica content, settings and wishes are required.');
const settingKeys = new Set(['showRsvp', 'showWishes', 'showGallery', 'showCountdown', 'showGuestCount']);
for (const [key, value] of Object.entries(config.settings)) {
  if (!settingKeys.has(key) || typeof value !== 'boolean') throw new Error(`Unsupported preview setting: ${key}`);
}
if (config.rsvp !== undefined) {
  if (!isObject(config.rsvp) || typeof config.rsvp.enabled !== 'boolean' || config.rsvp.endpoint !== '/api/rsvp' || Object.keys(config.rsvp).some((key) => !['enabled', 'endpoint', 'googleForm'].includes(key))) throw new Error('RSVP configuration must contain only enabled:boolean and endpoint:"/api/rsvp".');
}
if (config.rsvp?.googleForm) {
  const form = config.rsvp.googleForm;
  if (!isObject(form) || !/^https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(form.url) || !['nameEntry','attendanceEntry','blessingsEntry'].every(key => /^entry\.\d+$/.test(form[key]))) throw new Error('Invalid Google Form URL or field mapping.');
}
const rsvpEnabled = config.rsvp?.enabled === true;
if (publicMode && (config.settings.showRsvp !== rsvpEnabled || config.settings.showWishes !== false)) {
  throw new Error('Public RSVP visibility must match its configured same-origin integration; wishes remain disabled.');
}
let site;
if (config.site !== undefined || publicMode) {
  if (!isObject(config.site)) throw new Error('Public mode requires invitation site metadata.');
  const keys = new Set(['title', 'description', 'origin', 'image', 'imageWidth', 'imageHeight', 'imageAlt']);
  for (const key of Object.keys(config.site)) if (!keys.has(key)) throw new Error(`Unsupported site metadata field: ${key}`);
  for (const key of ['title', 'description', 'imageAlt']) {
    if (typeof config.site[key] !== 'string' || !config.site[key].trim()) throw new Error(`Site ${key} must be nonempty text.`);
  }
  if (typeof config.site.origin !== 'string') throw new Error('Site origin must be an HTTPS origin, or an empty string before deployment.');
  let origin = '';
  if (config.site.origin) {
    const url = new URL(config.site.origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || /^(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\])$/i.test(url.hostname) || url.hostname.endsWith('.localhost')) throw new Error('Site origin must be a public HTTPS origin without credentials, a path, query or fragment.');
    origin = url.origin;
  }
  if (typeof config.site.image !== 'string' || !/^\/(?!\/)[a-zA-Z0-9/_-]+\.(?:png|jpe?g|webp)$/.test(config.site.image)) throw new Error('Site image must be a local JPG, PNG or WebP path.');
  for (const key of ['imageWidth', 'imageHeight']) if (!Number.isInteger(config.site[key]) || config.site[key] < 1 || config.site[key] > 16384) throw new Error(`Site ${key} must be a positive pixel dimension.`);
  site = {...config.site, origin};
}
function validateMarkers(value, location = 'content') {
  if (Array.isArray(value)) return value.forEach((item, index) => validateMarkers(item, `${location}[${index}]`));
  if (!isObject(value)) return;
  if ('$daysFromNow' in value) {
    if (Object.keys(value).length !== 1 || !Number.isInteger(value.$daysFromNow) || Math.abs(value.$daysFromNow) > 3650) throw new Error(`Invalid date offset at ${location}`);
    return;
  }
  if ('$referencePlaceholder' in value) {
    if (Object.keys(value).length !== 1 || typeof value.$referencePlaceholder !== 'string') throw new Error(`Invalid reference placeholder at ${location}`);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype', 'isPreview', 'subdomain'].includes(key)) throw new Error(`Unsupported content field at ${location}.${key}`);
    validateMarkers(item, `${location}.${key}`);
  }
}
validateMarkers(config.content);

if (config.mode !== 'reference-demo') {
  const {weddingDate, weddingTime, weddingStart, timeZone} = config.content;
  if (timeZone !== 'Asia/Kolkata') throw new Error('This invitation currently supports the confirmed Asia/Kolkata event time zone.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weddingDate) || !Number.isFinite(Date.parse(weddingDate)) || new Date(weddingDate).toISOString().slice(0, 10) !== weddingDate) throw new Error('A valid fixed wedding calendar date is required.');
  const time = weddingTime?.match(/^(\d{1,2}):(\d{2}) (AM|PM)(?: onwards)?$/);
  if (!time || Number(time[1]) < 1 || Number(time[1]) > 12 || Number(time[2]) > 59) throw new Error('Wedding time must be an explicit 12-hour time.');
  const hour = Number(time[1]) % 12 + (time[3] === 'PM' ? 12 : 0);
  const expectedStart = `${weddingDate}T${String(hour).padStart(2, '0')}:${time[2]}:00+05:30`;
  if (weddingStart !== expectedStart) throw new Error('Wedding start must match its displayed date/time in Asia/Kolkata.');
  if (config.content.countdownStart && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+05:30$/.test(config.content.countdownStart) || !Number.isFinite(Date.parse(config.content.countdownStart)))) throw new Error('Countdown start must be an explicit Asia/Kolkata instant.');
}

// Verify the complete unmodified source snapshot before replacing any output.
const sourceFiles = new Map();
for (const entry of manifest.files) {
  if (path.isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes('..')) throw new Error(`Unsafe vendor path: ${entry.path}`);
  const data = await readFile(path.join(vendor, entry.path));
  if (data.length !== entry.bytes || sha256(data) !== entry.sha256) throw new Error(`Vendor snapshot changed: ${entry.path}`);
  sourceFiles.set(entry.path, data);
}
let socialAsset = null;
if (site && !sourceFiles.has(site.image.slice(1))) {
  if (!/^\/og\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(site.image)) throw new Error('Custom sharing images must use a local /og/ asset.');
  const file = site.image.slice(1);
  const source = `assets/${file}`;
  socialAsset = {file, source, data: await readFile(path.join(replica, source))};
}
const invitationIcon = publicMode ? await readFile(path.join(replica, 'assets/invitation-icon-sj.svg')) : null;
const varmalaIcon = await readFile(path.join(replica, 'assets/varmala.svg'));
const musicPlayer = await readFile(path.join(replica, 'music-player.js'), 'utf8');
const portraitAssets = [];
for (const person of [config.content.groom, config.content.bride]) {
  if (!person?.photo) continue;
  if (!/^\/portraits\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(person.photo)) throw new Error('Portraits must use a local portrait asset.');
  if (person.photoFocus && !/^(?:100|\d{1,2})% (?:100|\d{1,2})%$/.test(person.photoFocus)) throw new Error('Portrait focus must contain two percentages.');
  if (person.photoZoom !== undefined && (!Number.isFinite(person.photoZoom) || person.photoZoom < 0.75 || person.photoZoom > 1.5)) throw new Error('Portrait zoom must be between 0.75 and 1.5.');
  if (person.photoStill !== undefined && typeof person.photoStill !== 'boolean') throw new Error('Portrait still setting must be boolean.');
  for (const key of ['photoTranslateYPercent', 'photoTranslateYPx']) {
    if (person[key] !== undefined && (!Number.isFinite(person[key]) || Math.abs(person[key]) > 50)) throw new Error('Portrait vertical offsets must be finite and within +/-50.');
  }
  const asset = {file: person.photo.slice(1), source: 'assets' + person.photo};
  asset.data = await readFile(path.join(replica, asset.source));
  portraitAssets.push(asset);
}
let musicAsset;
if (config.content.music?.enabled) {
  const music = config.content.music;
  if (!/^\/music\/[a-zA-Z0-9_-]+\.(mp3|m4a|ogg)$/.test(music.src) || !Number.isFinite(music.volume) || music.volume < 0 || music.volume > 1) throw new Error('Enabled music needs a local audio asset and volume between 0 and 1.');
  musicAsset = {file: music.src.slice(1), source: 'assets' + music.src};
  musicAsset.data = await readFile(path.join(replica, musicAsset.source));
}

function replaceOnce(source, search, replacement, description) {
  if (source.split(search).length !== 2) throw new Error(`Reference changed: expected one ${description} seam.`);
  return source.replace(search, replacement);
}
const previewFile = '_next/static/chunks/9322-759e5fa3db2b25d6.js';
const sharedFile = '_next/static/chunks/3558-eb103990f9f205f6.js';
const templateFile = '_next/static/chunks/3631-5fdc183989e4f7ad.js';
const patches = new Map();
patches.set(previewFile, replaceOnce(sourceFiles.get(previewFile).toString(),
  'return(0,o.jsx)(d,{content:c,settings:{showRsvp:!0,showWishes:!0,showGallery:!0,showCountdown:!0},wishes:r,subdomain:"preview",isPreview:!0,embedded:s})',
  'return(0,o.jsx)(d,{content:globalThis.__ROYAL_GATEWAY_DEMO__.resolveContent(c),settings:globalThis.__ROYAL_GATEWAY_DEMO__.settings,wishes:globalThis.__ROYAL_GATEWAY_DEMO__.wishes,subdomain:"preview",isPreview:!0,embedded:s})',
  'preview content'));
patches.set(sharedFile, replaceOnce(sourceFiles.get(sharedFile).toString(),
  'l=(0,i.getImageProps)({src:o,alt:"",width:320,height:107}).props.src',
  'l=o', 'local attribution logo'));
patches.set(sharedFile, replaceOnce(patches.get(sharedFile),
  'onTouchMove:e=>{if(!S.current||M.current)return;e.preventDefault();let t=e.touches[0],{x:n,y:r}=O(t.clientX,t.clientY);z(n,r)}',
  'onTouchMove:e=>{if(!S.current||M.current)return;let t=e.touches[0],{x:n,y:r}=O(t.clientX,t.clientY);z(n,r)}',
  'scratch passive-touch correction'));
patches.set(templateFile, replaceOnce(sourceFiles.get(templateFile).toString(),
  '!b&&g&&(0,s.jsx)(tj.Z,{subdomain:g})', 'null', 'view tracker'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'function td(e){', musicPlayer + '\nfunction td(e){', 'optional music player'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'children:[null,C.length>1',
  'children:[(0,s.jsx)(RoyalMusicPlayer,{config:h.music}),null,C.length>1',
  'fixed music control placement'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'names:A,onOpen:()=>y(!0)',
  'names:A,onOpen:()=>{window.dispatchEvent(new Event("royal-gateway-open"));y(!0)}',
  'user-gesture music start'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'sectionRef:_,names:A,dateLabel:H,placeLabel:R',
  'sectionRef:_,names:A,dateLabel:h.celebrationDateLabel||H,placeLabel:R',
  'two-day celebration date banner'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  '(td,{coupleNames:P,dateLabel:H,hashtag:h.hashtag})',
  '(td,{coupleNames:P,dateLabel:h.celebrationDateLabel||H,hashtag:h.hashtag})',
  'two-day celebration date in closing invitation'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  '(e$,{events:h.events})',
  '(e$,{events:h.events.filter(event=>event.venueName),celebrationDateLabel:h.celebrationDateLabel})',
  'shared celebration date for venue section'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'let{events:t}=e,{t:a}=S(),n=(0,eg.Kn)(t);',
  'let{events:t,celebrationDateLabel:venueDateLabel}=e,{t:a}=S(),n=(0,eg.Kn)(t);',
  'venue section date label prop'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  '(e0,{main:e,timing:',
  '(e0,{main:e,celebrationDateLabel:i?void 0:venueDateLabel,timing:',
  'common venue date label'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'label:r.date,text:(0,eg.vX)(null==a?void 0:a.date,"long",o)',
  'label:r.date,text:e.celebrationDateLabel||(0,eg.vX)(null==a?void 0:a.date,"long",o)',
  'two-day date in venue card'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  ',{Icon:eI.Z,label:r.time,text:null==a?void 0:a.time}',
  '',
  'remove time row from common venue details'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'countdownTo:function(e,t){',
  'countdownTo:h.countdownStart||h.weddingStart?Date.parse(h.countdownStart||h.weddingStart):function(e,t){',
  'explicit celebration countdown instant'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'name:(0,m.v2)(i,r),parents:function',
  'name:(0,m.v2)(i,r),nameLines:"bride"===e?[u(i.firstName),u(i.lastName)].filter(Boolean):void 0,parents:function',
  'bride portrait name lines'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'portrait:g(i.photo)?{src:i.photo,zoom:1,focus:"center"}:o',
  'portrait:g(i.photo)?{src:i.photo,zoom:i.photoZoom||1,focus:i.photoFocus||"center",inset:(i.photoZoom||1)<1,still:i.photoStill===true,offsetY:i.photoTranslateYPercent||0,offsetPx:i.photoTranslateYPx||0}:o',
  'central portrait framing position'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'className:"mx-auto w-full max-w-xs lg:max-w-md",animate:{y:[0,-12,0]},transition:{duration:6,repeat:1/0,ease:"easeInOut",delay:l>0?1.5:0},whileHover:{scale:1.03}',
  'className:"mx-auto w-full max-w-xs lg:max-w-md",animate:{y:i.still?0:[0,-12,0]},transition:{duration:6,repeat:1/0,ease:"easeInOut",delay:l>0?1.5:0},whileHover:i.still?void 0:{scale:1.03}',
  'stable portrait head alignment'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'className:"h-full w-full",animate:{scale:[1,1.08,1]},transition:{duration:14,repeat:1/0,ease:"easeInOut"},children:(0,s.jsx)("img",{src:i.src,alt:a,loading:"lazy",className:"h-full w-full object-cover",style:{objectPosition:i.focus,transformOrigin:i.focus,transform:"scale(".concat(i.zoom,")")}})',
  'className:"relative h-full w-full",animate:{scale:i.still?1:[1,1.08,1]},transition:{duration:14,repeat:1/0,ease:"easeInOut"},children:(0,s.jsx)("img",{src:i.src,alt:a,loading:"lazy",className:"h-full w-full object-cover",style:{objectPosition:i.focus,transformOrigin:i.focus,transform:"translateY(calc("+(i.offsetY||0)+"% + "+(i.offsetPx||0)+"px)) scale("+i.zoom+")"}})',
  'clear portrait with stable framing and no filler'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'a.childOf(t,s.join(" & "))',
  'a.childOf(t,s.join(" and "))',
  'requested parent-line wording'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  '(0,s.jsx)("h3",{className:"font-cinzel-decorative text-xl text-[#9e141e] md:text-4xl lg:text-5xl",children:a})',
  '(0,s.jsx)("h3",{"aria-label":a,className:"font-cinzel-decorative text-xl text-[#9e141e] md:text-4xl lg:text-5xl",children:e.nameLines?e.nameLines.map((e,t)=>(0,s.jsx)("span",{className:"block",children:e},t)):a})',
  'portrait name heading line layout'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  '(0,s.jsx)(tk.Z,{})', 'null', 'remove requested Made with Invitima footer'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'function td(e){',
  `function RoyalFamilyAcknowledgement(e){
    let family=e.content;
    if(!family?.groups?.length)return null;
    return(0,s.jsxs)("section",{className:"rgw-family-note","aria-labelledby":"rgw-family-heading",children:[
      (0,s.jsx)("div",{className:"rgw-family-divider","aria-hidden":true}),
      (0,s.jsx)("h2",{id:"rgw-family-heading",className:"font-great-vibes",children:family.heading}),
      (0,s.jsx)("p",{className:"rgw-family-subtitle font-cinzel-decorative",children:family.subtitle}),
      (0,s.jsx)("ul",{className:"rgw-family-groups",children:family.groups.map((group,index)=>(0,s.jsxs)("li",{children:[
        (0,s.jsx)("h3",{className:"rgw-family-label",children:group.label}),
        (0,s.jsx)("ul",{className:"rgw-family-entries",style:{"--family-columns":group.entries.length===4?2:Math.min(3,group.entries.length)},children:group.entries.map((names,entryIndex)=>(0,s.jsx)("li",{className:"rgw-family-names"+(group.label==="RSVP"?" rgw-rsvp-names":""),children:names.map((name,i)=>(0,s.jsxs)("span",{children:[i>0&&(group.entrySeparators?.[entryIndex]??"&")&&(0,s.jsx)("span",{className:"rgw-family-and",children:group.entrySeparators?.[entryIndex]??"&"}),name]},name))},entryIndex))})
      ]},index))})
    ]});
  }function td(e){`,
  'closing family acknowledgement component'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  '(0,s.jsx)(tx,{footerRef:E})',
  '(0,s.jsx)(RoyalFamilyAcknowledgement,{content:h.familyAcknowledgement}),(0,s.jsx)(tx,{footerRef:E})',
  'closing family acknowledgement placement'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'let{e:t,i:a}=e,n=a%2==0,i=t.venueName||t.address,{t:l}=S();',
  'let{e:t,i:a}=e,n=a%2==0,i="",{t:l}=S();',
  'show common venue only in the dedicated venue section'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'children:t.icon}),(0,s.jsx)("h3",{className:"rgw-text-gold-grad',
  'children:t.icon==="/varmala.svg"?(0,s.jsx)("img",{src:t.icon,alt:"",style:{width:"14cqw",height:"14cqw",objectFit:"contain"}}):t.icon}),(0,s.jsx)("h3",{style:{maxWidth:"100%",overflowWrap:"normal",...(t.name.length>=15||t.name.split(" ").some(word=>word.length>=8)?{fontSize:"6.4cqw",lineHeight:1.3}:{})},className:"rgw-text-gold-grad',
  'responsive long ceremony headings and original varmala icon'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'let{src:t,title:a,place:n,subtitle:i}=e,l=(0,b.J)()',
  'let{src:t,title:a,place:n,subtitle:i,mapUrl:o}=e,l=(0,b.J)()',
  'map destination prop'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'children:[(0,s.jsx)("iframe",{title:a,className:"absolute inset-0 h-full w-full",style:{filter:',
  'children:[(0,s.jsx)("a",{href:o,target:"_blank",rel:"noopener noreferrer",className:"rgw-map-link","aria-label":"Open ".concat(n," in Google Maps (opens in a new tab)"),title:"Open in Google Maps"}),(0,s.jsx)("iframe",{title:a,tabIndex:-1,"aria-hidden":!0,className:"absolute inset-0 h-full w-full",style:{pointerEvents:"none",filter:',
  'whole-map accessible Google Maps link'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'place:i,subtitle:t.venueName?t.address:"",src:l',
  'place:i,subtitle:t.venueName?t.address:"",src:l,mapUrl:t.mapUrl',
  'use confirmed venue map link'));
if (publicMode) patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'b&&(0,s.jsx)("div",{className:"sticky top-0 z-40 bg-[#9e141e]/95 py-1.5 text-center font-inter text-xs tracking-wide text-[#fef4df] shadow-sm backdrop-blur-md",children:"PREVIEW — The Royal Gateway Template"})',
  'null', 'remove public invitation preview banner'));
if (rsvpEnabled) {
  patches.set(templateFile, replaceOnce(patches.get(templateFile),
    'className:"flex items-center gap-3",children:[(0,s.jsx)(c.E.button,{type:"button","aria-label":"Fewer guests"',
    'className:"rgw-guest-stepper flex items-center gap-3",children:[(0,s.jsx)(c.E.button,{type:"button","aria-label":"Fewer guests"',
    'compact mobile guest counter'));
  const sourceHandler = 'let M=async e=>{if(e.preventDefault(),x.trim()){if(D(""),a||!t){N("done");return}N("sending");try{await (0,e7.$T)(t,{guestName:x.trim().slice(0,120),attending:p?"yes":"no",guestCount:p&&l?Math.min(12,Math.max(1,f)):void 0,message:b.slice(0,500)}),N("done")}catch(e){D(e instanceof e7.MS?e.message:I.somethingWrong),N("error")}}}';
  const apiHandler = `let M=async e=>{
    e.preventDefault();
    if(!rsvpMounted.current||"sending"===j||rsvpRequest.current?.pending)return;
    const guestName=x.trim().slice(0,120);
    if(!guestName){D("Please enter your name.");N("error");return}
    const fields={guestName,attending:p?"yes":"no",guestCount:p?Math.min(12,Math.max(1,f)):void 0,message:b.slice(0,500),website:rsvpWebsite.slice(0,200)};
    const key=JSON.stringify(fields);
    const deadline=Date.now()+180000;
    const processingTimeout="Your RSVP is still processing. Please retry to check its status.";
    let request,controller,timer,pollTimer,resumePoll,cancelled=false,queued=false,failure="We could not confirm receipt of your RSVP. Please try again.";
    const cancel=()=>{cancelled=true;if(timer!==undefined){clearTimeout(timer);timer=undefined}if(pollTimer!==undefined){clearTimeout(pollTimer);pollTimer=undefined}if(resumePoll){const resume=resumePoll;resumePoll=undefined;resume()}};
    D("");N("sending");
    try{
      if(!rsvpRequest.current||rsvpRequest.current.key!==key){
        let id;
        if(typeof crypto.randomUUID==="function")id=crypto.randomUUID();
        else{const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");id=hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20)}
        rsvpRequest.current={key,id,pending:false};
      }
      request=rsvpRequest.current;request.pending=true;request.cancel=cancel;
      const body=JSON.stringify({...fields,submissionId:request.id});
      for(;;){
        if(cancelled||!rsvpMounted.current)return;
        const remaining=deadline-Date.now();
        if(remaining<=0){failure=processingTimeout;throw new Error("RSVP processing deadline reached")}
        controller=new AbortController();timer=setTimeout(()=>controller.abort(),Math.min(30000,remaining));
        let response,result;
        try{
          response=await fetch(globalThis.__ROYAL_GATEWAY_DEMO__.rsvp.endpoint,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body,keepalive:true,signal:controller.signal});
          result=await response.json().catch(()=>null);
        }finally{if(timer!==undefined){clearTimeout(timer);timer=undefined}}
        if(cancelled||!rsvpMounted.current)return;
        if(Date.now()>=deadline){failure=processingTimeout;throw new Error("RSVP processing deadline reached")}
        if(response.status===200&&result?.saved===true&&result.submissionId===request.id){N("done");return}
        if(response.status===202&&result?.saved===false&&result.pending===true&&result.received===true&&result.submissionId===request.id){N("done");return}
        if(response.status===202&&result?.saved===false&&result.pending===true&&result.submissionId===request.id){
          queued=true;
          await new Promise(resolve=>{resumePoll=resolve;pollTimer=setTimeout(()=>{pollTimer=undefined;resumePoll=undefined;resolve()},Math.min(5000,deadline-Date.now()))});
          continue;
        }
        if(response.status===503)failure="RSVP is not available yet. Please try again later.";
        else if(response.status===429)failure="Please wait a moment before trying again.";
        throw new Error("RSVP was not acknowledged");
      }
    }catch(error){if(cancelled||!rsvpMounted.current)return;D(queued&&Date.now()>=deadline?processingTimeout:controller?.signal.aborted?"The request timed out. We could not confirm receipt of your RSVP. Please try again.":failure);N("error")}
    finally{if(timer!==undefined)clearTimeout(timer);if(pollTimer!==undefined)clearTimeout(pollTimer);if(request){request.pending=false;if(request.cancel===cancel)delete request.cancel}}
  }`;
  const liveHandler = apiHandler;
  patches.set(templateFile, replaceOnce(patches.get(templateFile), sourceHandler, liveHandler, 'real RSVP submission handler'));
  patches.set(templateFile, replaceOnce(patches.get(templateFile),
    ',[C,D]=(0,n.useState)(""),{t:I}=S();if(!i)return null;let M=async e=>',
    ',[C,D]=(0,n.useState)(""),{t:I}=S(),[rsvpWebsite,setRsvpWebsite]=(0,n.useState)(""),rsvpRequest=(0,n.useRef)(null),rsvpMounted=(0,n.useRef)(!0);(0,n.useEffect)(()=>{rsvpMounted.current=!0;return()=>{rsvpMounted.current=!1;rsvpRequest.current?.cancel?.()}},[]);if(!i)return null;let M=async e=>',
    'RSVP retry identity and honeypot state'));
  patches.set(templateFile, replaceOnce(patches.get(templateFile),
    '(0,s.jsxs)(c.E.form,{onSubmit:M,className:"space-y-6",',
    '(0,s.jsxs)(c.E.form,{onSubmit:M,"aria-busy":"sending"===j,className:"space-y-6",',
    'RSVP submitting accessibility state'));
  patches.set(templateFile, replaceOnce(patches.get(templateFile),
    '"error"===j&&(0,s.jsx)("p",{role:"alert",className:"text-center text-[#ffb3c0]",children:C})',
    '"sending"===j&&(0,s.jsx)("p",{role:"status","aria-live":"polite",className:"text-center text-[#fff3dc]",children:"Sending your RSVP… Please wait for confirmation."}),"error"===j&&(0,s.jsx)("p",{role:"alert",className:"text-center text-[#ffb3c0]",children:C})',
    'RSVP queued storage status'));
  patches.set(templateFile, replaceOnce(patches.get(templateFile),
    'className:"mt-3 text-xl text-[#fff3dc]",children:I.received',
    'role:"status","aria-live":"polite",className:"mt-3 text-xl text-[#fff3dc]",children:"Your RSVP has been received."',
    'RSVP durable receipt confirmation'));
  patches.set(templateFile, replaceOnce(patches.get(templateFile),
    'children:[(0,s.jsxs)(c.E.div,{variants:w,className:"text-center",children:[(0,s.jsx)(tt,{names:r})',
    'children:[(0,s.jsx)("input",{name:"website",type:"text",value:rsvpWebsite,onChange:e=>setRsvpWebsite(e.target.value),maxLength:200,tabIndex:-1,autoComplete:"off","aria-hidden":!0,style:{display:"none"}}),(0,s.jsxs)(c.E.div,{variants:w,className:"text-center",children:[(0,s.jsx)(tt,{names:r})',
    'invisible RSVP honeypot'));
}

patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'children:t.name}),t.note&&',
  'children:t.name==="Reception & Dinner"?[(0,s.jsx)("span",{style:{display:"block",whiteSpace:"nowrap"},children:"Reception"},"reception"),(0,s.jsx)("span",{style:{display:"block"},children:"&"},"and"),(0,s.jsx)("span",{style:{display:"block"},children:"Dinner"},"dinner")]:t.name}),t.note&&',
  'three matching lines for Reception, ampersand and Dinner'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'className:"rgw-text-halo",children:[(0,s.jsx)("p",{className:"mt-6 font-great-vibes',
  'className:"rgw-text-halo rgw-person-card",children:[(0,s.jsx)("p",{className:"mt-6 font-great-vibes',
  'ornamental couple detail panels'));

patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'className:"grid grid-cols-2 items-start gap-5 md:gap-16"',
  'className:"rgw-couple-grid grid grid-cols-2 items-start gap-5 md:gap-16"',
  'equal-height couple columns'));

patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'className:"mt-3 font-cinzel-decorative text-sm tracking-[0.18em] text-[#8a5a12]",children:(0,th.RG)(n)',
  'className:"rgw-contact-number mt-3 font-cinzel-decorative text-sm tracking-[0.18em] text-[#8a5a12]",children:(0,th.RG)(n)',
  'slightly bolder phone numbers'));

if (config.settings.showGuestCount === false) {
  const source = patches.get(templateFile);
  const begin = source.indexOf('(0,s.jsx)(o.M,{initial:!1,children:p&&l&&');
  const end = source.indexOf(',(0,s.jsxs)(c.E.div,{variants:w,children:[(0,s.jsx)("label",{htmlFor:"rgw-rsvp-message"', begin);
  if (begin < 0 || end <= begin) throw new Error('Guest counter seam changed.');
  patches.set(templateFile, replaceOnce(source, source.slice(begin, end), 'null', 'remove the guest counter section'));
}

patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'missed:"You will be missed, and remembered in our prayers."',
  'missed:"You will be missed."',
  'shorter declined RSVP confirmation'));

// Personal details remain data-driven for each invitation.
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'nameLines:"bride"===e?[u(i.firstName),u(i.lastName)].filter(Boolean):void 0,parents:',
  'nameLines:[u(i.firstName),u(i.lastName)].filter(Boolean),details:i,parents:',
  'balanced couple names and family details'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  'n&&(0,s.jsx)("p",{className:"mt-2 text-sm italic leading-snug text-[#5f3b2f] md:text-base lg:text-xl",children:n})',
  'e.details?.designation&&(0,s.jsx)("p",{className:"rgw-person-designation",children:e.details.designation}),e.details?.nickname&&(0,s.jsx)("p",{className:"rgw-person-nickname",children:"("+e.details.nickname+")"}),n&&(0,s.jsx)("p",{className:"rgw-person-detail",children:n}),(0,s.jsx)("p",{className:"rgw-person-detail",children:e.details?.grandparents}),(0,s.jsx)("p",{className:"rgw-person-detail",children:e.details?.address})',
  'service designations, grandparents and hometowns'));
patches.set(templateFile, replaceOnce(patches.get(templateFile),
  '(0,s.jsx)(E,{kicker:a.blessingsOfElders,children:a.royalCouple})',
  '(0,s.jsxs)("div",{className:"rgw-invocation",children:[(0,s.jsx)("p",{className:"font-cinzel-decorative",children:t.invocation}),(0,s.jsx)("p",{children:t.invitationText})]}),(0,s.jsx)(E,{kicker:a.blessingsOfElders,children:a.royalCouple})',
  'Ganesh invocation and family invitation'));

const serializedConfig = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const prelude = `/* Generated from replica/content.json. Original platform APIs remain disabled. */
(() => {
  "use strict";
  const config = ${serializedConfig};
  const now = Date.now();
  function resolve(value, reference) {
    if (Array.isArray(value)) return value.map((item, index) => resolve(item, reference?.[index]));
    if (value && typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, "$daysFromNow")) return new Date(now + value.$daysFromNow * 86400000).toISOString();
      if (Object.prototype.hasOwnProperty.call(value, "$referencePlaceholder")) {
        if (typeof reference !== "string" || !reference.startsWith("data:image/svg+xml")) throw new Error("Reference image placeholder is unavailable.");
        return reference;
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, reference?.[key])]));
    }
    return value;
  }
  Object.defineProperty(globalThis, "__ROYAL_GATEWAY_DEMO__", { value: Object.freeze({
    settings: Object.freeze(config.settings),
    wishes: Object.freeze(config.wishes),
    rsvp: Object.freeze(config.rsvp || {enabled:false,endpoint:"/api/rsvp"}),
    resolveContent: (reference) => resolve(config.content, reference)
  }), writable: false, configurable: false });
})();
`;

let html = sourceFiles.get('frame.html').toString();
html = replaceOnce(html, '<head>', '<head><script src="/replica-content.js"></script>', 'content prelude insertion');
html = replaceOnce(html, '</head>', '<style>.rgw-map-link{position:absolute;inset:0;z-index:2;border-radius:inherit;cursor:pointer}.rgw-map-link:focus-visible{outline:4px solid #fff1b8;outline-offset:-6px}</style></head>', 'map link focus styling');
html = replaceOnce(html, '</head>', `<style>
.rgw-music-toggle{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:110;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:10px 14px;border:1px solid #e3b44c;border-radius:999px;background:#650e20;color:#fff1c5;box-shadow:0 3px 12px #39051130;font-family:inherit;font-size:16px;line-height:1.25;cursor:pointer}
.rgw-music-toggle:hover{background:#85102a}.rgw-music-toggle:focus-visible{outline:3px solid #94601f;outline-offset:4px}
@media(max-width:639px){.rgw-music-toggle{right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));font-size:15px;padding:10px 12px}}
</style></head>`, 'fixed accessible music toggle');
html = replaceOnce(html, '</head>', `<style>
.rgw-couple-grid{align-items:stretch}.rgw-couple-grid>div{display:flex;flex-direction:column;min-width:0}.rgw-couple-grid .rgw-person-card{flex:1;width:100%;display:flex;flex-direction:column;align-items:center}.rgw-couple-grid .rgw-person-detail:last-child{margin-top:auto;width:100%}
.rgw-person-card{position:relative;margin:28px auto 0;padding:0 24px 28px;max-width:480px;background:linear-gradient(145deg,#fffaf0f5,#f9e7c9f5);border:1px solid #c69a52;border-radius:120px 120px 16px 16px / 32px 32px 16px 16px;box-shadow:0 10px 30px #6e172714,inset 0 0 0 5px #fff8e8,inset 0 0 0 6px #d4ac6866;text-shadow:none}
.rgw-person-card::before{content:"❖";display:block;color:#aa762a;font-size:24px;padding-top:20px}
.rgw-person-card>p:first-of-type{margin-top:8px;color:#805016}
.rgw-person-card h3{font-weight:600;color:#84152a;line-height:1.18;margin-top:8px}
.rgw-person-nickname{font-size:20px;font-style:italic;color:#805016;margin:8px 0 0}
.rgw-person-designation{display:table;color:#fff2ce;background:linear-gradient(110deg,#76132a,#a12538);border:1px solid #bd8a3c;border-radius:999px;font-family:Georgia,serif;letter-spacing:.16em;font-size:14px;margin:16px auto 22px;padding:5px 18px;font-weight:700;box-shadow:0 3px 8px #6e172720}
.rgw-person-detail{font-size:18px;line-height:1.65;font-weight:500;color:#482b25;margin:16px auto;max-width:360px;text-wrap:pretty}
.rgw-person-detail:last-child{border-top:1px solid #bd8a3c66;padding-top:16px;font-size:15px;font-style:italic;color:#774621}
.rgw-invocation{max-width:680px;margin:0 auto 48px;text-align:center;color:#482b25;line-height:1.8;font-size:20px;font-weight:500}.rgw-invocation>p:first-child{color:#84152a;font-size:24px;margin-bottom:16px}
.rgw-family-note{max-width:1040px;margin:0 auto;padding:24px 24px 80px;text-align:center;color:#482b25}
.rgw-family-divider{display:flex;align-items:center;justify-content:center;gap:16px;margin:0 auto 24px;color:#a97524}.rgw-family-divider::before,.rgw-family-divider::after{content:"";width:80px;height:1px;background:linear-gradient(90deg,transparent,#b78535,transparent)}.rgw-family-divider{height:20px;background:none}.rgw-family-divider::before{box-shadow:0 3px #b7853533}
.rgw-family-note h2{font-size:52px;line-height:1.3;color:#84152a;margin:0}
.rgw-family-subtitle{font-size:14px;font-weight:600;letter-spacing:.2em;color:#805016;margin:10px 0 36px}
.rgw-family-groups{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr;gap:36px}
.rgw-family-groups>li{min-width:0;padding:0 12px}
.rgw-family-groups>li+li{border-top:1px solid #b98b4344;padding-top:32px}
.rgw-family-entries{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(var(--family-columns),minmax(0,1fr));gap:24px 28px}
.rgw-family-label{font-size:14px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:#865f34;margin:0 0 20px}
.rgw-family-names{font-size:24px;font-weight:400;line-height:1.5;margin:0;overflow-wrap:break-word;color:#653c2b}.rgw-family-names>span{display:block}.rgw-family-and{font-style:italic;font-size:.85em;color:#93662b;margin-right:6px}.rgw-family-groups>li:last-child .rgw-family-names{font-size:21px;margin:auto;font-weight:400}
.rgw-contact-number{font-weight:600!important;color:#6d3027!important}
.rgw-rsvp-names{white-space:nowrap;font-size:clamp(16px,4.3vw,24px)!important}.rgw-rsvp-names>span{display:inline}.rgw-rsvp-names .rgw-family-and{margin-left:6px}
@media(max-width:767px){.rgw-person-card{padding:0 12px 18px;margin-top:20px;border-radius:40px 40px 12px 12px}.rgw-person-card h3{font-size:clamp(16px,3.8vw,28px)}.rgw-person-card>p:first-of-type{font-size:28px}.rgw-person-detail{font-size:15px;line-height:1.6}.rgw-person-detail:last-child{font-size:13px}.rgw-person-designation{font-size:12px;padding:4px 12px}.rgw-invocation{font-size:17px}.rgw-invocation>p:first-child{font-size:19px}.rgw-family-note{padding:12px 20px 60px}.rgw-family-note h2{font-size:40px}.rgw-family-subtitle{font-size:12px}.rgw-family-groups{grid-template-columns:1fr;gap:20px}.rgw-family-groups>li{padding:0}.rgw-family-groups>li+li{padding-top:26px}.rgw-family-entries{grid-template-columns:1fr;gap:18px}.rgw-family-names{font-size:23px}.rgw-family-label{font-size:13px}.rgw-family-groups>li:last-child .rgw-family-names{font-size:18px}}
</style></head>`, 'subtle closing family typography');
html = replaceOnce(html, '</head>', '<style>@media(max-width:767px){.rgw-guest-stepper{gap:2px}.rgw-guest-stepper>button{width:44px;height:44px;flex-shrink:0;padding:6px;background:none;box-shadow:none}.rgw-guest-stepper>button>span{border:2px solid #e3b44c;box-shadow:0 2px 5px #0003}.rgw-guest-stepper>[aria-live]{width:26px;height:32px}.rgw-guest-stepper>[aria-live]>span{font-size:22px}}</style></head>', 'compact mobile guest counter styles');
const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
const orderedCouple = config.content.nameOrder === 'bride' ? [config.content.bride, config.content.groom] : [config.content.groom, config.content.bride];
html = replaceOnce(html, '>Rahul<!-- --> &amp; <!-- -->Priya</p>',
  `>${escapeText(orderedCouple[0]?.firstName)}<!-- --> &amp; <!-- -->${escapeText(orderedCouple[1]?.firstName)}</p>`, 'server-rendered names in invitation order');
// Keep every asset local, including the source platform's social-preview artwork.
html = html.replaceAll('https://invitima.com/og/site.png', '/og/site.png');
if (publicMode) {
  // The pinned Next response stores its head as a JSON Flight row. Parse that
  // row as data, then use the same nodes for SSR HTML and hydrated metadata.
  const image = site.origin ? new URL(site.image, site.origin).href : site.image;
  const replacements = new Map(Object.entries({
    description: site.description, 'application-name': site.title,
    'og:title': site.title, 'og:description': site.description, 'og:site_name': site.title,
    'og:image': image, 'og:image:width': String(site.imageWidth), 'og:image:height': String(site.imageHeight), 'og:image:alt': site.imageAlt,
    'twitter:title': site.title, 'twitter:description': site.description,
    'twitter:image': image, 'twitter:image:width': String(site.imageWidth), 'twitter:image:height': String(site.imageHeight), 'twitter:image:alt': site.imageAlt,
  }));
  const removeNames = new Set(['creator', 'publisher', 'google-site-verification', 'msvalidate.01']);
  const removeLinks = new Set(['manifest', 'icon', 'apple-touch-icon', 'canonical']);
  let metadataNodes;
  let rowsChanged = 0;
  const scriptJSON = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  html = html.replace(/<script>([\s\S]*?)<\/script>/g, (tag, code) => {
    const prefix = 'self.__next_f.push(';
    if (!code.startsWith(prefix) || !code.endsWith(')')) return tag;
    const record = JSON.parse(code.slice(prefix.length, -1));
    if (record[0] !== 1 || typeof record[1] !== 'string') return tag;
    const lines = record[1].split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].startsWith('9:')) continue;
      const nodes = JSON.parse(lines[index].slice(2));
      if (!Array.isArray(nodes) || !nodes.some((node) => node[0] === '$' && node[1] === 'title')) throw new Error('Pinned Flight metadata row has changed.');
      metadataNodes = nodes.filter((node) => !((node[1] === 'meta' && removeNames.has(node[3]?.name)) || (node[1] === 'link' && removeLinks.has(node[3]?.rel)))).map((node) => {
        const props = {...node[3]};
        if (node[1] === 'title') props.children = site.title;
        const key = props.name || props.property;
        if (replacements.has(key)) props.content = replacements.get(key);
        return [node[0], node[1], node[2], props];
      });
      if (site.origin) {
        metadataNodes.push(['$', 'meta', 'invitation-url', {property: 'og:url', content: site.origin + '/'}]);
        metadataNodes.push(['$', 'link', 'invitation-canonical', {rel: 'canonical', href: site.origin + '/'}]);
      }
      metadataNodes.push(['$', 'link', 'invitation-icon', {rel: 'icon', href: '/invitation-icon-sj.svg', type: 'image/svg+xml', sizes: 'any'}]);
      lines[index] = '9:' + JSON.stringify(metadataNodes);
      rowsChanged++;
    }
    record[1] = lines.join('\n');
    return `<script>${prefix}${scriptJSON(record)})</script>`;
  });
  if (rowsChanged !== 1) throw new Error('Expected exactly one pinned Flight metadata row.');
  const renderNode = ([, tag, , props]) => {
    if (tag === 'title') return `<title>${escapeText(props.children)}</title>`;
    if (!['meta', 'link'].includes(tag)) throw new Error(`Unexpected metadata node: ${tag}`);
    return `<${tag}${Object.entries(props).map(([key, value]) => ` ${key === 'charSet' ? 'charset' : key}="${escapeText(value)}"`).join('')}/>`;
  };
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
  if (!headMatch) throw new Error('Reference HTML head is missing.');
  const retainedHead = headMatch[1].replace(/<title>[\s\S]*?<\/title>|<meta\b[^>]*\/>|<link\b[^>]*\/>/g, (tag) => {
    if (/^<(?:title|meta)\b/.test(tag)) return '';
    const rel = tag.match(/\brel="([^"]+)"/)?.[1];
    return removeLinks.has(rel) ? '' : tag;
  });
  html = html.replace(headMatch[0], `<head>${metadataNodes.map(renderNode).join('')}${retainedHead}</head>`);
}
if (!/<meta name="robots" content="noindex, nofollow"/.test(html)) throw new Error('Reference noindex metadata is missing.');
const inlineScriptHashes = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  .filter((match) => match[1]).map((match) => `sha256-${createHash('sha256').update(match[1]).digest('base64')}`);

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const entry of manifest.files) {
  if (entry.path === 'frame.html') continue;
  const destination = path.join(staging, entry.path);
  await mkdir(path.dirname(destination), { recursive: true });
  if (patches.has(entry.path)) await writeFile(destination, patches.get(entry.path));
  else await copyFile(path.join(vendor, entry.path), destination);
}
await writeFile(path.join(staging, 'index.html'), html);
await mkdir(path.join(staging, 'template-frame/royal-gateway'), { recursive: true });
await writeFile(path.join(staging, 'template-frame/royal-gateway/index.html'), html);
await writeFile(path.join(staging, 'replica-content.js'), prelude);
if (invitationIcon) await writeFile(path.join(staging, 'invitation-icon-sj.svg'), invitationIcon);
await writeFile(path.join(staging, 'varmala.svg'), varmalaIcon);
if (musicAsset) {
  await mkdir(path.dirname(path.join(staging, musicAsset.file)), {recursive: true});
  await writeFile(path.join(staging, musicAsset.file), musicAsset.data);
}
for (const asset of [...portraitAssets, ...(socialAsset ? [socialAsset] : [])]) {
  await mkdir(path.dirname(path.join(staging, asset.file)), {recursive: true});
  await writeFile(path.join(staging, asset.file), asset.data);
}
await writeFile(path.join(staging, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
await writeFile(path.join(staging, '404.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">' + (publicMode ? '<link rel="icon" href="/invitation-icon-sj.svg" type="image/svg+xml" sizes="any">' : '') + '<title>Page not found</title></head><body><main><h1>Page not found</h1><p>This invitation page could not be found.</p><a href="/">Return to the invitation</a></main></body></html>\n');
await rm(output, { recursive: true, force: true });
await rename(staging, output);
const verification = {
  schemaVersion: 1,
  sourceManifestSha256: sha256(await readFile(path.join(vendor, 'source-manifest.json'))),
  contentSha256: sha256(await readFile(path.join(replica, 'content.json'))),
  inlineScriptHashes: [...new Set(inlineScriptHashes)],
  patches: [...patches].map(([file, data]) => ({ file, sourceSha256: sha256(sourceFiles.get(file)), preparedSha256: sha256(data) })),
  localAssets: [...(invitationIcon ? [{file: 'invitation-icon-sj.svg', source: 'assets/invitation-icon-sj.svg', sha256: sha256(invitationIcon)}] : []), {file: 'varmala.svg', source: 'assets/varmala.svg', sha256: sha256(varmalaIcon)}, ...(musicAsset ? [{file: musicAsset.file, source: musicAsset.source, sha256: sha256(musicAsset.data)}] : []), ...[...portraitAssets, ...(socialAsset ? [socialAsset] : [])].map(({file, source, data}) => ({file, source, sha256: sha256(data)}))],
  patchNotes: ['Central content seam with fixed preview mode', 'Direct local attribution logo', 'Remove redundant preventDefault from passive scratch touch handler; original touchAction:none remains', 'Remove inactive view-tracker call', 'Use explicit countdownStart with weddingStart fallback for a time-zone-correct personalised countdown', 'Place the bride surname on its own line in the couple portrait heading', 'Remove the requested Made with Invitima footer and its padded row', ...(publicMode ? ['Remove preview banner while retaining original-platform API-blocking preview mode', 'Personalise SSR and Flight metadata; remove source verification and installation branding'] : []), ...(rsvpEnabled ? ['Preserve original RSVP appearance while submitting to the same-origin API with retry identity, keepalive delivery and explicit durable receipt'] : [])],
  entryPoints: ['/', '/template-frame/royal-gateway/'],
  mode: config.mode,
  rsvpDelivery: rsvpEnabled ? 'same-origin-api' : false,
  rsvpEndpoint: rsvpEnabled ? config.rsvp.endpoint : null,
  wishesDelivery: false,
};
await writeFile(path.join(replica, 'prepared-manifest.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(`Prepared ${path.relative(project, output)}/ from ${manifest.files.length} verified original files.`);
console.log(config.rsvp?.googleForm ? 'RSVP submits through the same-origin relay to Google Forms and stays on the invitation.' : rsvpEnabled ? 'RSVP uses /api/rsvp and requires a matching durable receipt or saved acknowledgement. Backend availability must be verified separately.' : publicMode ? 'Public static invitation: RSVP and wishes are disabled; API delivery remains blocked.' : 'Local preview: RSVP and wishes show the original local confirmation only; nothing is sent or stored.');
