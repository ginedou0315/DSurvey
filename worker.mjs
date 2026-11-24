const types = ['text','textarea','email','date','number','select'];
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2,'0')).join('');
const hash = async key => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), n => n.toString(16).padStart(2,'0')).join('');
const json = (value,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const str = (s,max) => typeof s==='string' ? s.trim().slice(0,max) : '';
async function body(req) {
  if(!req.headers.get('content-type')?.startsWith('application/json') || !req.body) fail('Send a JSON request.',415);
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let raw = '', size = 0;
  while(true) {
    const {done,value}=await reader.read();
    if(done) break;
    size+=value.byteLength;
    if(size>768000) {
      await reader.cancel();
      fail('Submission is too large.',413);
    }
    raw+=decoder.decode(value,{stream:true});
  }
  raw+=decoder.decode();
  try { const value=JSON.parse(raw); if(value && typeof value==='object' && !Array.isArray(value)) return value; } catch {}
  fail('Invalid request.');
}
function definition(input, previous) {
  const title = str(input.title,120);
  if(!title || !Array.isArray(input.fields) || input.fields.length<1 || input.fields.length>30) fail('Enter a title and 1 to 30 questions.');
  const old = new Map([...(previous?.fields||[]),...(previous?.archived||[])].map(f=>[f.id,f]));
  const used = new Set();
  const fields = input.fields.map(f=>{
    if(!f || typeof f!=='object') fail('Invalid question.');
    const id = f.id;
    const label = str(f.label,120);
    const options = f.type==='select' && Array.isArray(f.options) ? [...new Set(f.options.map(o=>str(o,120)).filter(Boolean))].slice(0,30) : [];
    if(typeof id!=='string' || !/^[\w-]{1,48}$/.test(id) || used.has(id) || !label || !types.includes(f.type) || (f.type==='select' && options.length<2)) fail('Check question names and provide at least two choices for dropdowns.');
    used.add(id);
    return {id,label,type:f.type,required:!!f.required,options};
  });
  const archived = [...old.values()].filter(f=>!used.has(f.id));
  if(archived.length>100) fail('This form has reached its archived-question limit.');
  return {title,description:str(input.description,2000),open:input.open!==false,fields,archived,revision:(previous?.revision||0)+1};
}
function validate(input,form) {
  if(input.revision!==form.revision) fail('The form changed. Reload the page and try again.',409);
  if(!input.answers || typeof input.answers!=='object') fail('Missing answers.');
  return Object.fromEntries(form.fields.map(f=>{
    const value=str(Object.hasOwn(input.answers,f.id) ? input.answers[f.id] : '',4001);
    if((f.required && !value) || value.length>4000) fail('Check '+f.label+'.');
    if(value && ((f.type==='select' && !f.options.includes(value)) ||
      (f.type==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) ||
      (f.type==='number' && !Number.isFinite(Number(value))) ||
      (f.type==='date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)))) fail('Check '+f.label+'.');
    return [f.id,value];
  }));
}
export default {async fetch(req,env) {
  const url = new URL(req.url);
  try {
    if(url.pathname==='/' && req.method==='GET') return new Response(PAGE.replace('<html lang="en">',env.DSURVEY_CREATOR_KEY ? '<html lang="en" data-creation-protected="true">' : '<html lang="en">'),{headers:{
      'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'no-referrer',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    }});
    if(req.method==='GET' && Object.hasOwn(ASSETS,url.pathname)) {
      const asset=ASSETS[url.pathname];
      return new Response(Uint8Array.from(atob(asset.base64),character=>character.charCodeAt(0)),{headers:{
        'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'
      }});
    }
    if(!env.DB) fail('Response storage is unavailable.',503);
    if(req.method!=='GET' && req.headers.get('origin') && req.headers.get('origin')!==url.origin) fail('Invalid origin.',403);
    const db = env.DB;
    if(url.pathname==='/api/forms' && req.method==='POST') {
      const input=await body(req);
      if(env.DSURVEY_CREATOR_KEY && (typeof input.creatorKey!=='string' || await hash(input.creatorKey)!==await hash(env.DSURVEY_CREATOR_KEY))) fail('The form creation key is incorrect.',403);
      const form=definition(input);
      const id=crypto.randomUUID(), key=token();
      await db.prepare('INSERT INTO surveys VALUES (?, ?, ?)').bind(id,await hash(key),JSON.stringify(form)).run();
      return json({id,key,form},201);
    }
    const path=/^\/api\/forms\/([\da-f-]{36})(?:\/(responses|manage))?$/.exec(url.pathname);
    if(!path) fail('Page not found.',404);
    const [,id,action]=path;
    const row=await db.prepare('SELECT owner, definition FROM surveys WHERE id=?').bind(id).first();
    if(!row) fail('Form not found.',404);
    const form=JSON.parse(row.definition);
    if(action==='manage' || (action==='responses' && ['GET','DELETE'].includes(req.method))) {
      const key=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization')||'')?.[1];
      if(!key || !/^[a-f0-9]{64}$/.test(key) || await hash(key)!==row.owner) fail('A valid management link is required.',403);
      if(action==='manage' && req.method==='PUT') {
        const input=await body(req);
        if(input.revision!==form.revision) fail('Another edit was saved. Reload before editing again.',409);
        const next=definition(input,form);
        const result=await db.prepare('UPDATE surveys SET definition=? WHERE id=? AND definition=?').bind(JSON.stringify(next),id,row.definition).run();
        if(!result.meta.changes) fail('Another edit was saved. Reload before editing again.',409);
        return json(next);
      }
      if(action==='manage' && req.method==='GET') return json(form);
      if(action==='responses' && req.method==='DELETE') {
        const response=Number(url.searchParams.get('response'));
        if(!Number.isSafeInteger(response)||response<1) fail('Invalid response.',400);
        const result=await db.prepare('DELETE FROM responses WHERE survey_id=? AND id=?').bind(id,response).run();
        if(!result.meta.changes) fail('Response not found.',404);
        return json({deleted:true});
      }
      if(action==='responses' && req.method==='GET') {
        const after=Number(url.searchParams.get('after')||0);
        const {results}=await db.prepare('SELECT id, submitted, answers FROM responses WHERE survey_id=? AND id>? ORDER BY id LIMIT 200').bind(id,Number.isSafeInteger(after)&&after>=0?after:0).all();
        return json(results.map(r=>({...r,answers:JSON.parse(r.answers)})));
      }
    }
    if(!action && req.method==='GET') {
      const {archived,...publicForm}=form;
      return json(publicForm);
    }
    if(action==='responses' && req.method==='POST') {
      if(!form.open) fail('This form is closed.',409);
      const answers=validate(await body(req),form);
      const result=await db.prepare('INSERT INTO responses (survey_id, submitted, answers) SELECT id, ?, ? FROM surveys WHERE id=? AND definition=?').bind(new Date().toISOString(),JSON.stringify(answers),id,row.definition).run();
      if(!result.meta.changes) fail('The form changed. Reload the page and try again.',409);
      return json({received:true},201);
    }
    fail('Method not allowed.',405);
  } catch(error) {
    if(!error.status) console.error(error);
    return json({error:error.status?error.message:'The request could not be completed.'},error.status||500);
  }
}};
