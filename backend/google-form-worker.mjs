// Same-origin relay for this invitation's public Google Form.
// Success is returned only when Google responds with its saved-response page.
const recent = new Map();
const reply = (status, body, extra = {}) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store',...extra}});
async function readLimited(body, limit) {
  const reader = body.getReader(); const parts=[]; let size=0;
  try { for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>limit){await reader.cancel();throw new Error('Too large');}parts.push(value); } }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
}
export async function handleGoogleFormRsvp(request, form, fetchUpstream=fetch) {
  if(request.method!=='POST') return reply(405,{saved:false},{Allow:'POST'});
  if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site') return reply(403,{saved:false});
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||'')) return reply(415,{saved:false});
  let data;
  try {data=JSON.parse(await readLimited(request.body,8192));}catch{return reply(400,{saved:false});}
  if(!data || typeof data.guestName!=='string' || !data.guestName.trim() || data.guestName.length>120 || !['yes','no'].includes(data.attending) || typeof data.message!=='string' || data.message.length>500 || (data.website!==undefined&&data.website!=='') || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.submissionId)) return reply(400,{saved:false});
  if(!form || !/^https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(form.url) || !['nameEntry','attendanceEntry','blessingsEntry'].every(key=>/^entry\.\d+$/.test(form[key]))) return reply(503,{saved:false});
  const identity=JSON.stringify([form.url,data.guestName.trim(),data.attending,data.message]);
  const key=form.url+':'+data.submissionId;
  for(const [id,item] of recent) if(item.expires<Date.now())recent.delete(id);
  const previous=recent.get(key);
  if(previous){if(previous.identity!==identity)return reply(409,{saved:false});const result=await previous.result;return reply(result.status,result.body);}
  if(recent.size>=500)return reply(429,{saved:false},{'Retry-After':'60'});
  const result=(async()=>{
    try {
      const target=form.url.replace(/viewform$/,'formResponse');
      const body=new URLSearchParams({[form.nameEntry]:data.guestName.trim(),[form.attendanceEntry]:data.attending==='yes'?'YES':'NO',[form.blessingsEntry]:data.message,fvv:'1',pageHistory:'0'});
      const response=await fetchUpstream(target,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept-Language':'en'},body:body.toString(),redirect:'follow',signal:AbortSignal.timeout(25000)});
      const html=await readLimited(response.body,1024*1024);
      const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
      if(response.ok && response.url===target && /Your response has been recorded\./i.test(text) && !/accounts\.google\.com\/.*ServiceLogin/.test(response.url)) return {status:200,body:{saved:true,submissionId:data.submissionId}};
    } catch {}
    return {status:502,body:{saved:false,error:'We could not confirm your RSVP. Please contact the family if this continues.'}};
  })();
  // Coalesce same-process retries, including ambiguous timeouts. This cache is
  // not durable across worker restarts; it must not be described as exactly-once.
  recent.set(key,{identity,result,expires:Date.now()+15*60*1000});
  const outcome=await result;return reply(outcome.status,outcome.body);
}
