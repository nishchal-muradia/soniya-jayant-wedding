import test from 'node:test';
import assert from 'node:assert/strict';
import {handleGoogleFormRsvp} from '../backend/google-form-worker.mjs';
const form={url:'https://docs.google.com/forms/d/e/test-form/viewform',nameEntry:'entry.1',attendanceEntry:'entry.2',blessingsEntry:'entry.3'};
let sequence=0;
const data=()=>({submissionId:`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,guestName:' Test & Guest ',attending:'yes',message:'Warm wishes & joy!',website:''});
const request=(body,origin='http://localhost:4174')=>new Request('http://localhost:4174/api/rsvp',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const upstream=(html,status=200,url=form.url.replace('viewform','formResponse'))=>{const r=new Response(html,{status});Object.defineProperty(r,'url',{value:url});return r;};
test('posts mapped answers and confirms only an explicit Google receipt',async()=>{
  const input=data();let calls=0;
  const fetcher=async(url,options)=>{calls++;assert.equal(url,form.url.replace('viewform','formResponse'));assert.equal(options.method,'POST');const body=new URLSearchParams(options.body);assert.equal(body.get('entry.1'),'Test & Guest');assert.equal(body.get('entry.2'),'YES');assert.equal(body.get('entry.3'),'Warm wishes & joy!');assert.equal(body.has('guestCount'),false);return upstream('<div>Your response has been recorded.</div>');};
  const response=await handleGoogleFormRsvp(request(input),form,fetcher);assert.equal(response.status,200);assert.deepEqual(await response.json(),{saved:true,submissionId:input.submissionId});
  await handleGoogleFormRsvp(request(input),form,fetcher);assert.equal(calls,1);
  assert.equal((await handleGoogleFormRsvp(request({...input,message:'changed'}),form,fetcher)).status,409);
});
test('decline maps to NO',async()=>{let mapped;const response=await handleGoogleFormRsvp(request({...data(),attending:'no'}),form,async(_url,options)=>{mapped=new URLSearchParams(options.body).get('entry.2');return upstream('<div>Your response has been recorded.</div>');});assert.equal(response.status,200);assert.equal(mapped,'NO');});
test('never reports success for validation pages, login, closed forms or upstream failure',async()=>{
  for(const response of [upstream('<form>Name</form>'),upstream('<p>No longer accepting responses</p>'),upstream('<div>Your response has been recorded.</div>',200,'https://accounts.google.com/login'),upstream('<div>Your response has been recorded.</div>',500),upstream('<script>"Your response has been recorded."</script>')]) {
    const result=await handleGoogleFormRsvp(request(data()),form,async()=>response);assert.equal(result.status,502);assert.equal((await result.json()).saved,false);
  }
});
test('ambiguous transport failure is not acknowledged or blindly reposted in the same process',async()=>{const input=data();let calls=0;const fetcher=async()=>{calls++;throw new Error('timeout');};assert.equal((await handleGoogleFormRsvp(request(input),form,fetcher)).status,502);assert.equal((await handleGoogleFormRsvp(request(input),form,fetcher)).status,502);assert.equal(calls,1);});
test('rejects invalid names, cross-origin requests and honeypots without contacting Google',async()=>{
  const fetcher=()=>{throw new Error('must not run');};
  for(const input of [{...data(),guestName:''},{...data(),website:'spam'},{...data(),message:'x'.repeat(501)}])assert.equal((await handleGoogleFormRsvp(request(input),form,fetcher)).status,400);
  assert.equal((await handleGoogleFormRsvp(request(data(),'https://other.test'),form,fetcher)).status,403);
  assert.equal((await handleGoogleFormRsvp(new Request('http://localhost:4174/api/rsvp'),form,fetcher)).status,405);
});
