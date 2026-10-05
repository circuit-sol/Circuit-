'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const ids={circuit_drops:'G4JKqCUDcfFSyQ6t2EpuCUoNtN9JwZGW3vMySnnWaFtj',circuit_escrow:'AWraC1ZQVWzjfRfzYB87U9nvEHYnowXrYTjZrdLVuDg9'};
const dest=path.join(root,'backend/idl');
fs.mkdirSync(dest,{recursive:true});
for(const [name,id] of Object.entries(ids)) {
  const src=path.join(root,`target/idl/${name}.json`);
  const text=fs.readFileSync(src,'utf8');
  if(JSON.parse(text).address!==id)throw new Error(`Wrong address in ${src}; rebuild IDL first`);
  fs.writeFileSync(path.join(dest,`${name}.json`),text);
  console.log(`Copied public IDL: backend/idl/${name}.json`);
}
