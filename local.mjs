import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './dist/server/index.js';

const database=new DatabaseSync(process.env.DSURVEY_DB_PATH||'dsurvey.sqlite');
database.exec('PRAGMA foreign_keys=ON');
database.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
const migration='0000_dsurvey';
if(!database.prepare('SELECT name FROM local_migrations WHERE name=?').get(migration)){
  database.exec('BEGIN');
  try {
    database.exec(readFileSync('drizzle/'+migration+'.sql','utf8'));
    database.prepare('INSERT INTO local_migrations VALUES (?)').run(migration);
    database.exec('COMMIT');
  } catch(error) { database.exec('ROLLBACK'); throw error; }
}
const DB={prepare(sql){const statement=database.prepare(sql);return {bind(...values){return {
  first:()=>statement.get(...values), all:()=>({results:statement.all(...values)}),
  run:()=>({meta:statement.run(...values)})
};}};}};
const port=Number(process.env.DSURVEY_PORT||8787);
http.createServer(async (req,res)=>{
  try {
    const chunks=[];
    let size=0;
    for await(const chunk of req){
      size+=chunk.length;
      if(size>768000){res.writeHead(413,{'Content-Type':'application/json'}).end('{"error":"Submission is too large."}');return;}
      chunks.push(chunk);
    }
    const options={method:req.method,headers:req.headers};
    if(!['GET','HEAD'].includes(req.method)) options.body=Buffer.concat(chunks);
    const result=await worker.fetch(new Request('http://'+req.headers.host+req.url,options),{DB,DSURVEY_CREATOR_KEY:process.env.DSURVEY_CREATOR_KEY});
    res.writeHead(result.status,Object.fromEntries(result.headers));
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch {res.writeHead(500).end('Request failed');}
}).listen(port,'127.0.0.1',()=>console.log('DSurvey http://127.0.0.1:'+port));
