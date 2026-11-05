import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Execute only the preview-data module with a harmless JSX collector, never the
// application/browser runtime. This checks the real original and prepared seams.
const root = path.dirname(fileURLToPath(import.meta.url));
const filename = '_next/static/chunks/9322-759e5fa3db2b25d6.js';
const config = JSON.parse(await readFile(path.join(root, 'content.json'), 'utf8'));
const frozenTime = Date.parse('2030-01-01T00:00:00Z');
function getProps(source, prelude, now = frozenTime) {
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({ self: {}, Date: FrozenDate });
  if (prelude) vm.runInContext(prelude, context, { timeout: 1000 });
  vm.runInContext(source, context, { timeout: 1000 });
  const factories = context.self.webpackChunk_N_E[0][1];
  const exports = {};
  const require = (id) => {
    if (id === 57437) return { jsx: (_component, props) => props };
    if (id === 68519) return { t4: () => function Preview() {} };
    if (id === 30608) return { B3: 'festival-wish' };
    throw new Error(`Unexpected data-module dependency ${id}`);
  };
  require.d = (target, definitions) => {
    for (const [key, get] of Object.entries(definitions)) Object.defineProperty(target, key, { get });
  };
  factories[9322]({}, exports, require);
  return { props: exports.default({ slug: 'royal-gateway', config: { theme: config.content.theme } }), context };
}
const original = await readFile(path.join(root, 'vendor', filename), 'utf8');
const prepared = await readFile(path.join(root, 'public', filename), 'utf8');
const prelude = await readFile(path.join(root, 'public/replica-content.js'), 'utf8');
const sourceProps = getProps(original).props;
const { props: preparedProps, context } = getProps(prepared, prelude);
const plain = (value) => JSON.parse(JSON.stringify(value));
// Preserve the source fixture independently of the editable invitation. The
// pinned vendor must still be the same reference preview we inspected.
assert.equal(sourceProps.content.groom.firstName, 'Rahul');
assert.equal(sourceProps.content.bride.firstName, 'Priya');
assert.equal(Date.parse(sourceProps.content.weddingDate) - frozenTime, 45 * 86400000);
assert.deepEqual(plain(sourceProps.content.events.map((event) => (Date.parse(event.date) - frozenTime) / 86400000)), [42,43,44,45,46]);

// Resolve the two permitted reference markers independently, then compare all
// fields. This catches stale generated output and accidental source fallbacks.
function expectedContent(value, reference) {
  if (Array.isArray(value)) return value.map((item, index) => expectedContent(item, reference?.[index]));
  if (value && typeof value === 'object') {
    if ('$daysFromNow' in value) return new Date(frozenTime + value.$daysFromNow * 86400000).toISOString();
    if ('$referencePlaceholder' in value) {
      assert.equal(typeof reference, 'string', 'Reference artwork marker must resolve to a source image');
      assert.ok(reference.startsWith('data:image/svg+xml'));
      return reference;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expectedContent(item, reference?.[key])]));
  }
  return value;
}
assert.deepEqual(plain(preparedProps.content), expectedContent(config.content, sourceProps.content), 'Prepared invitation content must match replica/content.json');
assert.deepEqual(plain(preparedProps.settings), config.settings, 'Prepared settings must match replica/content.json');
assert.deepEqual(plain(preparedProps.wishes), config.wishes, 'Prepared wishes must match replica/content.json');
assert.equal(preparedProps.isPreview, true);
assert.equal(preparedProps.subdomain, 'preview');
assert.equal(preparedProps.embedded, sourceProps.embedded);
if (config.mode === 'reference-demo') {
  assert.deepEqual(plain(preparedProps), plain(sourceProps), 'Reference-demo mode must reproduce the complete original preview');
} else {
  assert.ok(['personalised-draft', 'public-static'].includes(config.mode));
  const content = preparedProps.content;
  assert.equal(content.timeZone, 'Asia/Kolkata', 'Confirmed programme uses Indian Standard Time');
  assert.deepEqual(plain(content.events.map((event) => event.name)), ['Ganpati Sthapana', 'Mataji Pujan', 'Kalash', 'Dovda', 'Sangeet Ceremony', 'Mayra', 'Baraat Welcome', 'Panigrahan Sanskar']);
  assert.deepEqual(plain(content.events.map((event) => event.time)), ['7:30 AM', '10:00 AM', '3:00 PM', '6:00 PM', '7:00 PM', '1:00 PM', '6:00 PM', 'Midnight']);
  const dateOnly = (value) => {
    assert.match(value, /^\d{4}-\d{2}-\d{2}$/, 'Personalised dates must be fixed calendar dates');
    const date = new Date(value + 'T00:00:00Z');
    assert.ok(Number.isFinite(date.getTime()), 'Invalid calendar date');
    assert.equal(date.toISOString().slice(0, 10), value, 'Calendar dates must not roll over');
    return value;
  };
  dateOnly(content.weddingDate);
  assert.equal(content.events.at(-1).date, content.weddingDate);
  const knownInstants = [];
  for (const [index, event] of content.events.entries()) {
    dateOnly(event.date);
    assert.equal(event.order, index, 'Programme order must follow the confirmed chronology');
    if (index) assert.ok(event.date >= content.events[index - 1].date, 'Event dates must be chronological');
    assert.equal(typeof event.venueName, 'string');
    assert.equal(event.venueName, 'Dhariwal Stadium');
    assert.equal(event.mapUrl, 'https://maps.app.goo.gl/LK1MQxmR3vVCaHTe9');
    if (event.time === 'Midnight') {
      assert.equal(event.date, '2026-12-04');
      assert.equal(event.startsAt, '2026-12-05T00:00:00+05:30', 'Midnight after the 4 December baraat falls at the start of 5 December');
      assert.equal(event.note, 'Wedding');
      knownInstants.push(Date.parse(event.startsAt));
      continue;
    }
    const time = /^(\d{1,2}):(\d{2}) (AM|PM)( onwards)?$/.exec(event.time);
    assert.ok(time, 'Known programme times must use the supplied 12-hour format');
    const hour = Number(time[1]), minute = Number(time[2]);
    assert.ok(hour >= 1 && hour <= 12 && minute < 60, 'Invalid programme time');
    const hour24 = hour % 12 + (time[3] === 'PM' ? 12 : 0);
    const instant = Date.parse(`${event.date}T${String(hour24).padStart(2, '0')}:${time[2]}:00+05:30`);
    assert.ok(Number.isFinite(instant));
    // Round-trip through the named zone rather than the machine's local zone.
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: content.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map((part) => [part.type, part.value]));
    assert.equal(`${parts.year}-${parts.month}-${parts.day}`, event.date);
    assert.equal(`${parts.hour}:${parts.minute}`, `${String(hour24).padStart(2, '0')}:${time[2]}`);
    knownInstants.push(instant);
  }
  assert.deepEqual(knownInstants.map((instant) => new Date(instant).toISOString()), [
    '2026-12-02T02:00:00.000Z',
    '2026-12-02T04:30:00.000Z',
    '2026-12-02T09:30:00.000Z',
    '2026-12-02T12:30:00.000Z',
    '2026-12-03T13:30:00.000Z',
    '2026-12-04T07:30:00.000Z',
    '2026-12-04T12:30:00.000Z',
    '2026-12-04T18:30:00.000Z',
  ], 'The supplied programme must retain all eight India-time instants');
  assert.ok(knownInstants.every((instant, index) => index === 0 || instant > knownInstants[index - 1]), 'Known event instants must be strictly chronological in IST');
  assert.equal(content.weddingTime, '6:00 PM');
  assert.equal(content.events[6].time, content.weddingTime);
  assert.equal(content.weddingStart, '2026-12-04T18:00:00+05:30');
  assert.equal(Date.parse(content.weddingStart), knownInstants[6], 'The wedding-day welcome starts at 6 PM');
  assert.equal(Date.parse(content.countdownStart), knownInstants[0], 'Countdown must target Ganpati Sthapana on 2 December');
  assert.equal(content.nameOrder, 'bride');
  assert.equal(content.bride.firstName, 'Soniya');
  assert.equal(content.groom.firstName, 'Jayant');
  assert.ok(!JSON.stringify(content).includes('Sonu'));
  assert.equal(config.rsvp.googleForm.nameEntry, 'entry.318902185');
  assert.equal(config.rsvp.googleForm.attendanceEntry, 'entry.880028130');
  assert.equal(config.rsvp.googleForm.blessingsEntry, 'entry.228606542');
  // A personalised invitation must not regain the reference's moving dates.
  const resolvedAgain = getProps(prepared, prelude, frozenTime + 366 * 86400000).props.content;
  assert.equal(resolvedAgain.weddingDate, content.weddingDate);
  assert.equal(resolvedAgain.weddingStart, content.weddingStart);
  assert.equal(resolvedAgain.countdownStart, content.countdownStart);
  assert.deepEqual(plain(resolvedAgain.events.map((event) => event.date)), plain(content.events.map((event) => event.date)));
  assert.ok(!JSON.stringify(config.content).includes('"$daysFromNow"'), 'Personalised content must not retain moving-date markers');
}
// The template uses this same helper for the hero, people, RSVP and monogram.
const orderContext = vm.createContext({self:{}});
vm.runInContext(await readFile(path.join(root, 'vendor/_next/static/chunks/3558-eb103990f9f205f6.js'), 'utf8'), orderContext, {timeout:1000});
const orderExports = {};
const orderRequire = {d(target, definitions){for(const [name, getter] of Object.entries(definitions)) Object.defineProperty(target,name,{get:getter});}};
orderContext.self.webpackChunk_N_E[0][1][12891]({}, orderExports, orderRequire);
assert.deepEqual(plain(orderExports.XS(config.content, 'Jayant', 'Soniya')), ['Soniya', 'Jayant']);
assert.deepEqual(plain(orderExports.XS(config.content, 'groom', 'bride')), ['bride', 'groom']);
const descriptor = Object.getOwnPropertyDescriptor(context, '__ROYAL_GATEWAY_DEMO__');
assert.equal(descriptor.writable, false);
assert.equal(descriptor.configurable, false);
assert.equal(context.__ROYAL_GATEWAY_DEMO__.isPreview, undefined);
assert.equal(context.__ROYAL_GATEWAY_DEMO__.subdomain, undefined);
assert.deepEqual(plain(context.__ROYAL_GATEWAY_DEMO__.rsvp), config.rsvp || {enabled:false,endpoint:'/api/rsvp'});

const manifest = JSON.parse(await readFile(path.join(root, 'vendor/source-manifest.json'), 'utf8'));
for (const entry of manifest.files) {
  const data = await readFile(path.join(root, 'vendor', entry.path));
  assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, entry.path);
}
const shared = await readFile(path.join(root, 'public/_next/static/chunks/3558-eb103990f9f205f6.js'), 'utf8');
assert.ok(shared.includes('let o="/image/Logo.webp",a={width:144,height:48},l=o,'));
assert.ok(shared.includes('onTouchMove:e=>{if(!S.current||M.current)return;let t=e.touches[0],{x:n,y:r}=O(t.clientX,t.clientY);z(n,r)}'));
assert.ok(!shared.includes('onTouchMove:e=>{if(!S.current||M.current)return;e.preventDefault();'));
assert.ok(shared.includes('style:{touchAction:"none",cursor:R?"pointer":"default"}'));
const template = await readFile(path.join(root, 'public/_next/static/chunks/3631-5fdc183989e4f7ad.js'), 'utf8');
assert.ok(!template.includes('!b&&g&&(0,s.jsx)(tj.Z,{subdomain:g})'));
if (config.mode !== 'reference-demo') {
  assert.equal(template.split('countdownTo:h.countdownStart||h.weddingStart?Date.parse(h.countdownStart||h.weddingStart):').length, 2, 'Exactly one countdown must prefer the explicit celebration start');
  const countdown = template.match(/countdownTo:(h\.countdownStart\|\|h\.weddingStart\?Date\.parse\(h\.countdownStart\|\|h\.weddingStart\):[\s\S]*?),showCountdown:/);
  assert.ok(countdown, 'Pinned template countdown expression must be identifiable');
  // Evaluate only the countdown prop expression, with no browser runtime and
  // no Date constructor. A regression to viewer-local date construction fails.
  const target = vm.runInNewContext(`(${countdown[1]})`, { h: plain(preparedProps.content), Date: { parse: Date.parse }, u: String }, { timeout: 1000 });
  assert.equal(target, Date.parse('2026-12-02T02:00:00Z'), 'Template countdown must target 2 December at 7:30 AM IST regardless of guest time zone');
}
if (config.rsvp?.enabled) {
  assert.ok(!template.includes('if(D(""),a||!t){N("done");return}'), 'Live RSVP must not report the original fake preview success');
  const begin = template.indexOf('let M=async e=>');
  const end = template.indexOf(',W="mb-2 block font-cinzel-decorative', begin);
  assert.ok(begin !== -1 && end > begin, 'Pinned RSVP handler must remain identifiable');
  const handler = template.slice(begin + 'let M='.length, end);
  assert.ok(!handler.includes('e7.$T'), 'Live RSVP must not call the original platform API');
  assert.ok(template.includes('rsvpRequest=(0,n.useRef)(null)'), 'Submission identity must survive React renders');
  const lifecycle = template.match(/\(0,n\.useEffect\)\((\(\)=>\{rsvpMounted\.current=!0;return\(\)=>\{rsvpMounted\.current=!1;rsvpRequest\.current\?\.cancel\?\.\(\)\}\}),\[\]\)/)?.[1];
  assert.ok(lifecycle, 'RSVP must detach UI work when its component unmounts');
  assert.ok(template.includes('role:"status","aria-live":"polite",className:"text-center text-[#fff3dc]",children:"Sending your RSVP… Please wait for confirmation."'), 'Pending storage needs a readable live status in the original form');
  assert.ok(template.includes('name:"website",type:"text"') && template.includes('style:{display:"none"}'), 'Honeypot must remain invisible');
  function submissionHarness() {
    let serial = 0, clock = 0, active = 0, maxActive = 0;
    const timers = new Map(), calls = [], updates = [];
    const state = {
      x:'  Test Guest  ',p:true,f:2,b:'A blessing',rsvpWebsite:'',j:'idle',rsvpRequest:{current:null},rsvpMounted:{current:true},
      __ROYAL_GATEWAY_DEMO__:{rsvp:config.rsvp},AbortController,Uint8Array,Date:{now:()=>clock},
      crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},
      setTimeout:(callback,delay)=>{assert.ok(delay>0&&delay<=30000);const token={};timers.set(token,{callback,at:clock+delay});return token;},
      clearTimeout:(token)=>timers.delete(token),
      fetch:async(url,options)=>{
        const call={url,options,body:JSON.parse(options.body),at:clock};calls.push(call);
        active++;maxActive=Math.max(active,maxActive);
        try{return await state.respond(call);}finally{active--;}
      },
    };
    state.N=(value)=>{state.j=value;updates.push(['state',value]);};
    state.D=(value)=>{state.error=value;updates.push(['message',value]);};
    state.respond=async()=>({ok:false,status:503,json:async()=>({saved:false})});
    const context=vm.createContext(state);
    const submit=vm.runInContext(`(${handler})`,context,{timeout:1000});
    const unmount=vm.runInContext(`(${lifecycle})()`,context,{timeout:1000});
    const settle=()=>new Promise(resolve=>setImmediate(resolve));
    const advance=async(ms)=>{
      const target=clock+ms;
      await settle();
      for(;;){
        const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at).find(([,timer])=>timer.at<=target);
        if(!next)break;
        clock=next[1].at;timers.delete(next[0]);next[1].callback();await settle();
      }
      clock=target;await settle();
    };
    return {state,calls,timers,updates,unmount,settle,advance,get maxActive(){return maxActive;},submit:()=>submit({preventDefault(){}})};
  }
  const test = submissionHarness();
  await test.submit();
  assert.equal(test.state.j,'error');
  assert.match(test.state.error,/not available yet/);
  assert.equal(test.state.x,'  Test Guest  ');
  assert.equal(test.state.b,'A blessing');
  assert.equal(test.calls[0].url,'/api/rsvp');
  assert.equal(test.calls[0].options.method,'POST');
  assert.equal(test.calls[0].options.keepalive,true,'Submission should survive normal page unload');
  assert.equal(test.calls[0].options.credentials,'same-origin');
  assert.equal(test.calls[0].options.headers['Content-Type'],'application/json');
  assert.deepEqual(test.calls[0].body,{guestName:'Test Guest',attending:'yes',guestCount:2,message:'A blessing',website:'',submissionId:'00000000-0000-4000-8000-000000000001'});
  test.state.x='Test Guest';
  test.state.respond=async()=>({ok:true,status:200,json:async()=>({saved:true,submissionId:'wrong-id'})});
  await test.submit();
  assert.equal(test.state.j,'error');
  assert.equal(test.calls[1].body.submissionId,test.calls[0].body.submissionId,'Same normalized values must reuse the failed submission ID');
  test.state.respond=async()=>({ok:true,status:200,json:async()=>{throw new Error('HTML or malformed JSON');}});
  await test.submit();
  assert.equal(test.state.j,'error','HTTP 200 alone must not count as a saved RSVP');
  test.state.b='An updated blessing';
  await test.submit();
  assert.notEqual(test.calls[3].body.submissionId,test.calls[2].body.submissionId,'Changed fields need a new submission ID');
  test.state.respond=async(call)=>({ok:true,status:200,json:async()=>({saved:true,submissionId:call.body.submissionId})});
  await test.submit();
  assert.equal(test.state.j,'done','Matching explicit save acknowledgement should show the original success UI');
  assert.equal(test.calls[4].body.submissionId,test.calls[3].body.submissionId);
  assert.equal(test.timers.size,0,'Completion must clear the timeout');

  const decline=submissionHarness();
  decline.state.p=false;
  await decline.submit();
  assert.equal(decline.calls[0].body.attending,'no');
  assert.ok(!('guestCount' in decline.calls[0].body),'Declined RSVP must omit guestCount');
  const limits=submissionHarness();
  limits.state.x='N'.repeat(130);limits.state.b='B'.repeat(510);limits.state.f=20;
  await limits.submit();
  assert.equal(limits.calls[0].body.guestName.length,120);
  assert.equal(limits.calls[0].body.message.length,500);
  assert.equal(limits.calls[0].body.guestCount,12);
  const pending=submissionHarness();
  let complete;
  pending.state.respond=()=>new Promise((resolve)=>{complete=resolve;});
  const first=pending.submit();
  await pending.submit();
  assert.equal(pending.calls.length,1,'A second submit must not start while the first is pending');
  complete({ok:true,status:200,json:async()=>({saved:true,submissionId:pending.calls[0].body.submissionId})});
  await first;
  assert.equal(pending.state.j,'done');
  const timeout=submissionHarness();
  timeout.state.respond=(call)=>new Promise((resolve,reject)=>call.options.signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));
  const stalled=timeout.submit();
  await timeout.advance(30000);
  await stalled;
  assert.equal(timeout.state.j,'error');
  assert.match(timeout.state.error,/timed out.*could not confirm/);
  assert.equal(timeout.state.rsvpRequest.current.pending,false);
  const timedOutId=timeout.calls[0].body.submissionId;
  timeout.state.respond=async(call)=>({ok:true,status:200,json:async()=>({saved:true,submissionId:call.body.submissionId})});
  await timeout.submit();
  assert.equal(timeout.calls[1].body.submissionId,timedOutId,'A timed-out request must retain its retry identity');
  assert.equal(timeout.state.j,'done');

  const received=submissionHarness();
  received.state.respond=async(call)=>({ok:true,status:202,json:async()=>({saved:false,pending:true,received:true,submissionId:call.body.submissionId})});
  await received.submit();
  assert.equal(received.state.j,'done','Durable queue receipt must confirm without waiting for a Sheet write');
  assert.equal(received.calls.length,1,'No polling is needed once the server owns the reply');
  assert.equal(received.timers.size,0);
  received.unmount();
  await received.advance(180000);
  assert.equal(received.calls.length,1,'No browser work should be required for delivery after receipt');

  const queued=submissionHarness();
  queued.state.respond=async(call)=>({ok:true,status:queued.calls.length<3?202:200,json:async()=>queued.calls.length<3?
    {saved:false,pending:true,submissionId:call.body.submissionId}:{saved:true,submissionId:call.body.submissionId}});
  const queuedSubmission=queued.submit();
  await queued.settle();
  assert.equal(queued.state.j,'sending','Legacy or busy pending without explicit receipt must keep waiting');
  assert.equal(queued.calls.length,1);
  await queued.submit();
  assert.equal(queued.calls.length,1,'A second submit must not bypass a pending poll delay');
  await queued.advance(4999);
  assert.equal(queued.calls.length,1,'Polls must wait five seconds after the pending response');
  queued.state.b='Edited while waiting';
  await queued.advance(1);
  assert.equal(queued.calls.length,2);
  assert.equal(queued.state.j,'sending');
  await queued.advance(5000);
  await queuedSubmission;
  assert.equal(queued.state.j,'done');
  assert.deepEqual(queued.calls.map(call=>call.at),[0,5000,10000]);
  assert.ok(queued.calls.every(call=>call.options.body===queued.calls[0].options.body),'Every queued retry must retain the exact initial payload and UUID');
  assert.equal(queued.maxActive,1,'Polling must never issue parallel requests');
  assert.equal(queued.timers.size,0);

  for(const result of [{saved:false,pending:true,received:true,submissionId:'wrong-id'}, {saved:false,pending:'true',received:true}, {received:true}, {saved:true}]){
    const malformedPending=submissionHarness();
    malformedPending.state.respond=async(call)=>({ok:true,status:202,json:async()=>({submissionId:call.body.submissionId,...result})});
    await malformedPending.submit();
    assert.equal(malformedPending.state.j,'error','HTTP 202 must never imply success or accept an invalid pending acknowledgement');
    assert.equal(malformedPending.calls.length,1);
    assert.equal(malformedPending.timers.size,0);
  }
  const expired=submissionHarness();
  expired.state.respond=async(call)=>({ok:true,status:202,json:async()=>({saved:false,pending:true,submissionId:call.body.submissionId})});
  const processing=expired.submit();
  await expired.advance(180000);
  await processing;
  assert.equal(expired.state.j,'error');
  assert.equal(expired.state.error,'Your RSVP is still processing. Please retry to check its status.');
  assert.equal(expired.calls.length,36,'Stop polling at the three-minute deadline');
  assert.equal(expired.maxActive,1);
  assert.equal(expired.timers.size,0);
  assert.equal(expired.state.x,'  Test Guest  ');
  assert.equal(expired.state.b,'A blessing');
  const queuedId=expired.state.rsvpRequest.current.id;
  expired.state.respond=async(call)=>({ok:true,status:200,json:async()=>({saved:true,submissionId:call.body.submissionId})});
  await expired.submit();
  assert.equal(expired.calls.at(-1).body.submissionId,queuedId,'Retry after the processing deadline must check the same submission');
  assert.equal(expired.state.j,'done');

  const finalRequest=submissionHarness();
  finalRequest.state.respond=async(call)=>finalRequest.calls.length<36?
    {ok:true,status:202,json:async()=>({saved:false,pending:true,submissionId:call.body.submissionId})}:
    new Promise((resolve,reject)=>call.options.signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));
  const deadlineRequest=finalRequest.submit();
  await finalRequest.advance(180000);
  await deadlineRequest;
  assert.equal(finalRequest.calls.at(-1).at,175000);
  assert.ok(finalRequest.calls.at(-1).options.signal.aborted,'The last request must be cut short at the overall deadline');
  assert.equal(finalRequest.state.error,'Your RSVP is still processing. Please retry to check its status.');
  assert.equal(finalRequest.timers.size,0);

  for(const duringPoll of [false,true]){
    let finishDetached;
    const cancelled=submissionHarness();
    cancelled.state.respond=duringPoll?async(call)=>({ok:true,status:202,json:async()=>({saved:false,pending:true,submissionId:call.body.submissionId})}):
      call=>new Promise(resolve=>{finishDetached=()=>resolve({status:202,json:async()=>({saved:false,pending:true,received:true,submissionId:call.body.submissionId})});});
    const inFlight=cancelled.submit();
    await cancelled.settle();
    const updateCount=cancelled.updates.length;
    cancelled.unmount();
    assert.equal(cancelled.calls[0].options.signal.aborted,false,'Leaving must not abort the in-flight submission');
    finishDetached?.();
    await inFlight;
    await cancelled.advance(180000);
    assert.equal(cancelled.updates.length,updateCount,'Unmount must not update an absent form');
    assert.equal(cancelled.calls.length,1,'Unmount must stop new polls while allowing the active request to finish');
    assert.equal(cancelled.timers.size,0);
    assert.equal(cancelled.state.rsvpRequest.current.pending,false);
  }
  console.log('PASS: RSVP durable receipt without polling, strict unconfirmed/busy fallback, keepalive submission, stable retry IDs, timeouts and unmount without delivery cancellation. No real submissions were sent.');
} else assert.ok(template.includes('if(D(""),a||!t){N("done");return}'), 'Disabled integration retains the original local reference handler');
if (config.settings.showGuestCount === false) assert.ok(!template.includes('id:"rgw-rsvp-guests"'), 'Guest counter markup must be removed');
if (config.rsvp?.googleForm) {
  assert.ok(!template.includes('Continue to RSVP') && !template.includes('Tap Submit there'));
  assert.ok(!template.includes('window.location.assign'));
}
assert.ok(shared.includes('if(e.preventDefault(),p(""),c||!u){m(!0),v("");return}'), 'Original preview wishes branch must return before its API request');
if (config.mode === 'public-static') {
  assert.equal(preparedProps.settings.showRsvp, config.rsvp?.enabled === true);
  assert.equal(preparedProps.settings.showWishes, false);
  assert.ok(!template.includes('PREVIEW — The Royal Gateway Template'), 'Public invitation must omit the preview banner');
  assert.ok(template.includes('showRsvp:!1!==f.showRsvp'), 'RSVP visibility must use the central setting');
  assert.ok(template.includes('if(!i)return null;'), 'Disabled RSVP must return before rendering a form');
  assert.ok(template.includes('!1!==f.showWishes&&'), 'Disabled wishes must not render');
} else assert.ok(template.includes('PREVIEW — The Royal Gateway Template'));
const html = await readFile(path.join(root, 'public/index.html'), 'utf8');
assert.ok(html.indexOf('src="/replica-content.js"') < html.indexOf('src="/_next/static/'));
assert.ok(html.includes('name="robots" content="noindex, nofollow"'));
assert.ok(html.includes('>Soniya<!-- --> &amp; <!-- -->Jayant</p>'), 'Opening HTML must also put the bride first');
if (config.mode === 'public-static') {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  assert.ok(head, 'Public invitation needs an HTML head');
  const decode = (value) => value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"})[entity]);
  const headNodes = [...head.matchAll(/<(meta|link)\b([^>]*)>/g)].map(([, tag, attributes]) => [tag, Object.fromEntries([...attributes.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]))]);
  const metadataRows = [];
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const matched = script[1].match(/^self\.__next_f\.push\((\[[\s\S]*\])\)$/);
    if (!matched) continue;
    const record = JSON.parse(matched[1]);
    if (record[0] !== 1 || typeof record[1] !== 'string') continue;
    for (const line of record[1].split('\n')) if (line.startsWith('9:')) metadataRows.push(JSON.parse(line.slice(2)));
  }
  assert.equal(metadataRows.length, 1, 'Exactly one hydrated metadata row must remain');
  const flightNodes = metadataRows[0].map((node) => [node[1], node[3]]);
  assert.equal(decode(head.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ''), config.site.title);
  assert.deepEqual(flightNodes.filter(([tag]) => tag === 'title').map(([, props]) => props.children), [config.site.title]);
  const siteOrigin = config.site.origin ? new URL(config.site.origin).origin : '';
  const image = siteOrigin ? new URL(config.site.image, siteOrigin).href : config.site.image;
  const expectedMeta = {
    description: config.site.description, 'application-name': config.site.title,
    'og:title': config.site.title, 'og:description': config.site.description, 'og:site_name': config.site.title,
    'og:image': image, 'og:image:width': String(config.site.imageWidth), 'og:image:height': String(config.site.imageHeight), 'og:image:alt': config.site.imageAlt,
    'twitter:card': 'summary_large_image', 'twitter:title': config.site.title, 'twitter:description': config.site.description,
    'twitter:image': image, 'twitter:image:width': String(config.site.imageWidth), 'twitter:image:height': String(config.site.imageHeight), 'twitter:image:alt': config.site.imageAlt,
    ...(siteOrigin ? {'og:url': siteOrigin + '/'} : {}),
  };
  for (const [label, nodes] of [['HTML head', headNodes], ['Flight head', flightNodes]]) {
    for (const [key, value] of Object.entries(expectedMeta)) assert.deepEqual(nodes.filter(([tag, props]) => tag === 'meta' && (props.name || props.property) === key).map(([, props]) => props.content), [value], `${label}: ${key}`);
    assert.ok(!nodes.some(([tag, props]) => tag === 'meta' && ['creator', 'publisher', 'google-site-verification', 'msvalidate.01'].includes(props.name)), `${label}: source ownership verification must be removed`);
    assert.ok(!nodes.some(([tag, props]) => tag === 'link' && ['apple-touch-icon', 'manifest'].includes(props.rel)), `${label}: source installation branding must be removed`);
    assert.deepEqual(nodes.filter(([tag, props]) => tag === 'link' && props.rel === 'icon').map(([, props]) => props), [{rel: 'icon', href: '/invitation-icon-sj.svg', type: 'image/svg+xml', sizes: 'any'}], `${label}: explicit original favicon prevents the browser's default favicon request`);
    assert.deepEqual(nodes.filter(([tag, props]) => tag === 'link' && props.rel === 'canonical').map(([, props]) => props.href), siteOrigin ? [siteOrigin + '/'] : []);
  }
  const notFound = await readFile(path.join(root, 'public/404.html'), 'utf8');
  assert.ok(notFound.includes('<h1>Page not found</h1>') && !notFound.includes('__next_f'), 'Static 404 must be a real error page, not the invitation app');
}
console.log(`PASS: ${config.mode === 'reference-demo' ? 'exact reference-content equivalence and moving dates' : 'central personalised content, fixed dates and chronological IST programme'}, immutable preview seam, logo/tracker/touch patches, original-platform API safeguards and ${manifest.files.length} source hashes.`);
