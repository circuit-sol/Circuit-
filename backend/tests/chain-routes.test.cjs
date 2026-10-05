'use strict';
process.env.JWT_SECRET='test-only-'.repeat(10);
const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {issueSession}=require('../src/sessionAuth');
const createRoutes=require('../src/chain/routes');
const UID='10000000-0000-4000-8000-000000000001',IID='20000000-0000-4000-8000-000000000001',BID='30000000-0000-4000-8000-000000000001';
async function harness(t,verify) {
  const writes=[];
  const tables={users:[{id:UID,wallet_address:'wallet'}],chain_intents:[{id:IID,user_id:UID,wallet_address:'wallet',kind:'initialize',batch_id:BID,expected:{revision:1}}]};
  const db={from(name){let rows=tables[name]||[],write=false;
    const q={select(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},maybeSingle(){return Promise.resolve({data:rows[0]||null})},
      update(v){write=true;writes.push({name,v});return q},then(resolve){return Promise.resolve({data:rows}).then(resolve)}};
    return q;},rpc:async(name,args)=>{writes.push({name,args});return {data:null}}};
  const chain={verify,network:async()=>{}};
  const app=express();app.use(express.json());app.use('/api/chain',createRoutes(db,{enabled:true,chain}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const token=issueSession({id:UID,wallet_address:'wallet'}).token;
  const request=(url,body,auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/chain${url}`,{
    method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  return {request,writes,tables};
}
test('chain preparation requires JWT and rejects client-provided payment amounts',async t=>{
  const h=await harness(t);
  assert.equal((await h.request(`/batches/${BID}/purchase/prepare`,{},false)).status,401);
  const r=await h.request(`/batches/${BID}/purchase/prepare`,{amount_lamports:'1'});
  assert.equal(r.status,400);assert.equal((await r.json()).error,'UNSUPPORTED_FIELDS');
  assert.equal(h.writes.length,0);
});
test('failed/unfinalized verification cannot activate a batch or write an order',async t=>{
  const h=await harness(t,async()=>{const e=new Error('TRANSACTION_NOT_FINALIZED');e.status=202;throw e;});
  const r=await h.request(`/intents/${IID}/confirm`,{signature:'anything'});
  assert.equal(r.status,202);assert.equal(h.writes.length,0);
});
test('another user cannot submit or confirm an intent',async t=>{
  const h=await harness(t,async()=>{throw new Error('Must not reach chain verification');});
  h.tables.chain_intents[0].user_id='40000000-0000-4000-8000-000000000001';
  assert.equal((await h.request(`/intents/${IID}/confirm`,{signature:'anything'})).status,404);
  assert.equal(h.writes.length,0);
});
