import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
const page = await readFile('page.html','utf8');
const worker = await readFile('worker.mjs','utf8');
const assets = Object.fromEntries(await Promise.all(['app.js','reports.js'].map(async name =>
  ['/assets/' + name,await readFile(name,'utf8')])));
await writeFile('dist/server/index.js','const PAGE = '+JSON.stringify(page)+';\nconst ASSETS = '+JSON.stringify(assets)+';\n'+worker);
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
