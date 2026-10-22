const {test}=require('node:test');const assert=require('node:assert/strict');
const {normalizeSocialLinks:n}=require('../src/editionSocial');
test('social links accept public contact channels and reject unsafe or unsupported values',()=>{
 assert.equal(n({whatsapp:'+2348012345678',instagram:'https://instagram.com/brand',twitter:'https://x.com/brand',support_email:'help@example.com'}).whatsapp,'+2348012345678');
 assert.equal(n({}).instagram,'');
 for(const v of [null,[],{website:'https://a.com'},{twitter:'javascript:alert(1)'},{instagram:'https://instagram.com.evil.com/a'},{instagram:'https://user@instagram.com/a'},{whatsapp:'08012345678'},{support_email:22}])assert.throws(()=>n(v),/INVALID_SOCIAL_LINKS/);
});
process.env.JWT_SECRET='catalog-test-'.repeat(10);
const express=require('express');const routes=require('../src/chain/routes');
test('stats are public, invalid UUID is rejected, unavailable batch is hidden',async t=>{
 const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_batch_id.endsWith('1')?{batch:{claimed_units:3}}:null}}};
 const app=express();app.use('/api/chain',routes(db,{enabled:true,chain:{}}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const get=id=>fetch(`http://127.0.0.1:${server.address().port}/api/chain/batches/${id}/stats`);
 assert.equal((await get('bad')).status,400);assert.equal(calls.length,0);
 const r=await get('10000000-0000-4000-8000-000000000001');assert.equal(r.status,200);assert.equal((await r.json()).stats.batch.claimed_units,3);
 assert.equal((await get('10000000-0000-4000-8000-000000000002')).status,404);
});
