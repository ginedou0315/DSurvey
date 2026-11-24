import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
const page = await readFile('page.html','utf8');
const worker = await readFile('worker.mjs','utf8');
const files = {
  'app.js':'text/javascript; charset=utf-8',
  'reports.js':'text/javascript; charset=utf-8',
  'manifest.webmanifest':'application/manifest+json; charset=utf-8',
  'icon-180.png':'image/png',
  'icon-192.png':'image/png',
  'icon-512.png':'image/png'
};
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name,type]) => {
  const bytes = await readFile(name);
  return ['/assets/' + name,{type,base64:bytes.toString('base64')}];
})));
await writeFile('dist/server/index.js','const PAGE = '+JSON.stringify(page)+';\nconst ASSETS = '+JSON.stringify(assets)+';\n'+worker);
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
