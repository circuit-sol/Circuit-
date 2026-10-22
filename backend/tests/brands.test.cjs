'use strict';
process.env.JWT_SECRET = 'brand-test-only-'.repeat(8);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createRoutes = require('../src/brandRoutes');
const { issueSession } = require('../src/sessionAuth');
test('brand creation authenticates, binds identity, validates input and maps database failures', async t => {
  const user = { id: '10000000-0000-4000-8000-000000000001', wallet_address: 'test-wallet' };
  const calls = []; let error = null;
  const db = { rpc: async (fn, args) => { calls.push({ fn, args }); return { data: {id:'brand-id',role:'owner'}, error }; } };
  const app=express(); app.use(express.json()); app.use('/api/brands',createRoutes(db));
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const token=issueSession(user).token;
  async function post(body,auth=true){return fetch(`http://127.0.0.1:${server.address().port}/api/brands`,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});}
  assert.equal((await post({name:'Demo',slug:'demo'},false)).status,401);
  for(const body of [{name:'Demo',slug:'demo',user_id:'other'}, {name:'Demo',slug:'demo',payment_wallet_address:'other'}, {name:'',slug:'demo'}, {name:'Demo',slug:'a/b'}, []]) assert.equal((await post(body)).status,400);
  assert.equal(calls.length,0);
  const success=await post({name:' Demo ',slug:' Demo-Brand '});
  assert.equal(success.status,201); assert.equal((await success.json()).brand.role,'owner');
  assert.deepEqual(calls[0],{fn:'circuit_create_brand',args:{p_user_id:user.id,p_wallet_address:user.wallet_address,p_name:'Demo',p_slug:'demo-brand'}});
  for(const [code,status] of [['28000',401],['23505',409],['22023',400],['XX000',500]]){error={code};assert.equal((await post({name:'Demo',slug:'demo'})).status,status);}
});
