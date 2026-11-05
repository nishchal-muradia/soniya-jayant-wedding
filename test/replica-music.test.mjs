import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../replica/music-player.js', import.meta.url), 'utf8');
function harness(enabled = true, defaultOn = false, startAtSeconds = 0, autoPlay = false, playOverride) {
  const slots = [], effects = [], cleanups = [];
  let cursor = 0, mounted = false, tree;
  const window = new EventTarget();
  const media = {paused: true, calls: 0, volume: 1, play() {this.calls++; this.paused=false; return Promise.resolve();}, pause() {this.paused=true;}};
  if (playOverride) media.play = playOverride;
  const jsx = (tag, props) => ({tag, props});
  const n = {
    useRef(value) {const i=cursor++; return slots[i] ||= {current:value};},
    useState(value) {const i=cursor++; if(!(i in slots)) slots[i]=value; return [slots[i], v=>slots[i]=v];},
    useEffect(effect, deps) {
      const i=cursor++; const prior=slots[i];
      if (!prior || deps.some((v,index)=>!Object.is(v,prior[index]))) {
        slots[i]=deps; effects.push(()=>{cleanups[i]?.();cleanups[i]=effect();});
      }
    }
  };
  const context=vm.createContext({n,s:{jsx,jsxs:jsx,Fragment:'fragment'},window});
  vm.runInContext(source,context);
  const config={enabled,defaultOn,startAtSeconds,autoPlay,src:'/music/test.mp3',title:'Test',volume:.25,loop:true,startOnEntrance:true};
  function render() {
    cursor=0;
    tree=context.RoyalMusicPlayer({config});
    if(tree) tree.props.children[0].props.ref.current=media;
    return tree;
  }
  const initialTree=render();
  while(effects.length) effects.shift()(); mounted=true;
  render();
  while(effects.length) effects.shift()();
  return {initialTree,media,window,render,button:()=>render()?.props.children[1].props,audio:()=>render()?.props.children[0].props,unmount:()=>cleanups.forEach(f=>f?.())};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('initial client render matches the player-free server snapshot',()=>{const h=harness();assert.equal(h.initialTree,null);assert.ok(h.render());});

test('disabled music has no control or media playback',()=>{const h=harness(false);assert.equal(h.render(),null);h.window.dispatchEvent(new Event('royal-gateway-open'));assert.equal(h.media.calls,0);});
test('does not autoplay on load; gateway gesture starts quiet looping audio',async()=>{const h=harness();assert.equal(h.media.calls,0);assert.equal(h.audio().preload,'none');assert.equal(h.audio().loop,true);h.window.dispatchEvent(new Event('royal-gateway-open'));await settle();assert.equal(h.media.calls,1);assert.equal(h.media.volume,.25);assert.equal(h.button()['aria-label'],'Turn music off');});
test('toggle pauses and resumes, retaining explicit guest choice across gate opening',async()=>{const h=harness();h.button().onClick();await settle();h.button().onClick();assert.equal(h.media.paused,true);assert.equal(h.button()['aria-pressed'],false);h.window.dispatchEvent(new Event('royal-gateway-open'));assert.equal(h.media.calls,1);h.button().onClick();await settle();assert.equal(h.media.calls,2);});
test('rejected playback remains usable with a retry control',async()=>{const h=harness();h.media.play=()=>Promise.reject(new Error('blocked'));h.button().onClick();await settle();assert.equal(h.button()['aria-label'],'Retry music');assert.equal(h.button()['aria-pressed'],false);});
test('turning off during loading prevents stale completion from enabling music',async()=>{const h=harness();let resolve;h.media.play=()=>new Promise(r=>resolve=r);h.button().onClick();assert.equal(h.button()['aria-pressed'],true);h.button().onClick();resolve();await settle();h.audio().onPlaying();assert.equal(h.media.paused,true);assert.equal(h.button()['aria-pressed'],false);});
test('unmount pauses audio and removes gateway listener',()=>{const h=harness();h.unmount();h.window.dispatchEvent(new Event('royal-gateway-open'));assert.equal(h.media.calls,0);assert.equal(h.media.paused,true);});

 test('default-on is armed before entrance and plays on the gateway gesture',async()=>{const h=harness(true,true);assert.equal(h.media.calls,0);assert.equal(h.button()['aria-pressed'],true);assert.match(h.button().title,/Starts when you open/);h.window.dispatchEvent(new Event('royal-gateway-open'));await settle();assert.equal(h.media.calls,1);assert.equal(h.media.paused,false);assert.equal(h.button()['aria-pressed'],true);});
 test('guest can disable default-on before opening the gates',()=>{const h=harness(true,true);h.button().onClick();assert.equal(h.button()['aria-pressed'],false);h.window.dispatchEvent(new Event('royal-gateway-open'));assert.equal(h.media.calls,0);});

test('skips the silent intro on first playback and looping but preserves resume position',async()=>{
  const h=harness(true,true,5);
  Object.assign(h.media,{readyState:1,duration:240,currentTime:0});
  h.window.dispatchEvent(new Event('royal-gateway-open'));await settle();
  assert.equal(h.media.currentTime,5);
  h.media.currentTime=42;h.button().onClick();h.button().onClick();await settle();
  assert.equal(h.media.currentTime,42);
  h.media.currentTime=0;h.audio().onTimeUpdate();assert.equal(h.media.currentTime,5);
});
test('seeks after metadata arrives when audio was initially unloaded',()=>{
  const h=harness(true,true,5);Object.assign(h.media,{readyState:0,currentTime:0});
  h.window.dispatchEvent(new Event('royal-gateway-open'));assert.equal(h.media.currentTime,0);
  Object.assign(h.media,{readyState:1,duration:240});h.audio().onLoadedMetadata();assert.equal(h.media.currentTime,5);
});

test('autoplay starts immediately after mounting and preloads the audio',async()=>{
  const h=harness(true,true,0,true);await settle();
  assert.equal(h.audio().preload,'auto');assert.equal(h.media.calls,1);assert.equal(h.media.paused,false);
  h.window.dispatchEvent(new Event('royal-gateway-open'));assert.equal(h.media.calls,1);
});
test('blocked autoplay waits for first gesture without reporting a broken file',async()=>{
  let calls=0;
  const h=harness(true,true,0,true,function(){calls++;if(calls===1){const e=new Error('blocked');e.name='NotAllowedError';return Promise.reject(e);}this.paused=false;return Promise.resolve();});
  await settle();assert.equal(h.button()['aria-label'],'Play music');assert.equal(h.button()['aria-pressed'],false);
  h.window.dispatchEvent(new Event('pointerdown'));await settle();assert.equal(calls,2);assert.equal(h.media.paused,false);
  h.button().onClick();h.window.dispatchEvent(new Event('pointerdown'));h.window.dispatchEvent(new Event('royal-gateway-open'));assert.equal(calls,2);assert.equal(h.media.paused,true);
});
test('music button retries when the browser blocked autoplay',async()=>{
  const h=harness(true,true,0,true,function(){const e=new Error('blocked');e.name='NotAllowedError';return Promise.reject(e);});await settle();
  h.media.play=function(){this.paused=false;return Promise.resolve();};h.button().onClick();await settle();assert.equal(h.media.paused,false);
});
