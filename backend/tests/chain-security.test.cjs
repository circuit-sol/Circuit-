'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const anchor=require('@coral-xyz/anchor');
const {ChainService,pricing,total,verifiedMessage}=require('../src/chain/service');
const {Transaction,Keypair,SystemProgram}=anchor.web3;

test('integer SOL quotes reject floats, overflow and unsupported size selections',()=>{
  const p=pricing({unit_price_lamports:'1000000',prices_by_size_lamports:{M:'1200000'}});
  assert.equal(total(p,'M',3),'3600000');
  assert.throws(()=>total(p,'XL',1));
  assert.throws(()=>total(p,'M',1.5));
  assert.throws(()=>pricing({unit_price_lamports:0.1}));
  assert.throws(()=>pricing({unit_price_lamports:'1.5'}));
  assert.throws(()=>total(pricing({unit_price_lamports:'9007199254740991'}),null,2));
});

test('confirmation rejects pending, failed and different transaction messages',()=>{
  const buyer=Keypair.generate();
  const tx=new Transaction({feePayer:buyer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()})
    .add(SystemProgram.transfer({fromPubkey:buyer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:100}));
  const message=tx.compileMessage(),encoded=message.serialize().toString('base64');
  const result={version:'legacy',meta:{err:null},transaction:{message}};
  assert.doesNotThrow(()=>verifiedMessage(result,encoded));
  assert.throws(()=>verifiedMessage(null,encoded),e=>e.status===202);
  assert.throws(()=>verifiedMessage({...result,meta:{err:{InstructionError:[0,1]}}},encoded));
  assert.throws(()=>verifiedMessage(result,Buffer.from('different').toString('base64')));
});

test('prepared operational signature survives buyer signing; modified messages cannot be submitted',async()=>{
  const operational=Keypair.generate(),buyer=Keypair.generate();
  const chain=Object.create(ChainService.prototype);
  chain.signer=operational;
  let sends=0;
  chain.connection={getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),
    sendRawTransaction:async()=>{sends++;return 'signature';}};
  const ix=SystemProgram.transfer({fromPubkey:operational.publicKey,toPubkey:buyer.publicKey,lamports:1});
  const envelope=await chain.envelope(buyer.publicKey.toBase58(),[ix],true);
  const tx=Transaction.from(Buffer.from(envelope.transaction_base64,'base64'));
  assert.equal(tx.verifySignatures(),false);
  await assert.rejects(()=>chain.submit(envelope,envelope.transaction_base64),e=>e.message==='MISSING_OR_INVALID_SIGNATURE');
  tx.partialSign(buyer);
  assert.equal(tx.verifySignatures(),true);
  assert.equal(await chain.submit(envelope,tx.serialize().toString('base64')),'signature');
  tx.add(SystemProgram.transfer({fromPubkey:buyer.publicKey,toPubkey:operational.publicKey,lamports:5}));
  await assert.rejects(()=>chain.submit(envelope,tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')),e=>e.message==='TRANSACTION_MISMATCH');
  assert.equal(sends,1);
});
