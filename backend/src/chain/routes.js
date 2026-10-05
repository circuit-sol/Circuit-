"use strict";
const express=require('express');
const { randomUUID }=require('node:crypto');
const { requireAuth }=require('../sessionAuth');
const { ChainService,ensure,uuid,pub,pricing,exactBody,iso }=require('./service');
const { uuidBytes }=require('./batch-wire.cjs');
const ADMIN_ACTIONS=['freeze','unfreeze','refund','seller_payment','redirect'];
const sqlStatus={INVALID_OR_EXPIRED_SESSION:401,BRAND_ACCESS_DENIED:403,BATCH_NOT_FOUND:404};
module.exports=function createChainRoutes(db,options={}) {
  const router=express.Router();
  const enabled=options.enabled??process.env.CHAIN_ENABLED==='true';
  let chain=options.chain;
  // Fail startup on malformed keys/IDLs when explicitly enabled.
  if(enabled&&!chain) chain=new ChainService();
  const run=fn=>async(req,res)=>{
    try {await fn(req,res);} catch(e) {
      const status=e.status || (e.code==='P0001'?(sqlStatus[e.message]||409):503);
      // Do not print provider URLs, transaction payloads, keys, or database errors.
      if(!e.status&&e.code!=='P0001') console.error('Chain request failed:',e.code||e.name||'Error');
      res.status(status).json({error:e.status||e.code==='P0001'?e.message:'CHAIN_SERVICE_UNAVAILABLE',
        ...(status===202?{retry_after_seconds:3}: {})});
    }
  };
  const result=async query=>{const r=await query;if(r.error)throw r.error;return r.data;};
  const rpc=(name,args)=>result(db.rpc(name,args));
  const batch=id=>result(db.from('batches').select('*,edition:editions!inner(brand_id)').eq('id',uuid(id)).maybeSingle());
  async function managed(row,auth) {
    ensure(row,'BATCH_NOT_FOUND',404);
    const member=await result(db.from('brand_memberships').select('role').eq('user_id',auth.userId)
      .eq('brand_id',row.edition.brand_id).in('role',['owner','editor']).maybeSingle());
    ensure(member,'BRAND_ACCESS_DENIED',403);
  }
  async function admin(auth) {
    const cfg=(await chain.read(chain.drops,'circuitConfig',chain.config)).data;
    ensure(cfg.adminAuthority.equals(pub(auth.walletAddress)),'ADMIN_ACCESS_DENIED',403);
  }
  async function ownOrder(id,auth) {
    const order=await result(db.from('chain_orders').select('*').eq('id',uuid(id)).eq('user_id',auth.userId).maybeSingle());
    ensure(order&&order.buyer_wallet===auth.walletAddress,'ORDER_NOT_FOUND',404);return order;
  }
  async function intent(id,auth) {
    const i=await result(db.from('chain_intents').select('*').eq('id',uuid(id)).eq('user_id',auth.userId).maybeSingle());
    ensure(i&&i.wallet_address===auth.walletAddress,'INTENT_NOT_FOUND',404);return i;
  }
  async function limit(auth) {
    const q=await db.from('chain_intents').select('id',{count:'exact',head:true}).eq('user_id',auth.userId)
      .gte('created_at',new Date(Date.now()-60000).toISOString());
    if(q.error)throw q.error;ensure(q.count<20,'PREPARE_RATE_LIMIT',429);
  }
  async function prepare(auth,row,kind,ixs,expected={},orderId=null) {
    await limit(auth);
    const wire=await chain.envelope(auth.walletAddress,ixs,['initialize','purchase'].includes(kind));
    const i={id:randomUUID(),user_id:auth.userId,wallet_address:auth.walletAddress,batch_id:row.id,
      kind,order_id:orderId,expected,...wire};
    await result(db.from('chain_intents').insert(i));
    return {intent_id:i.id,kind,network:'devnet',transaction_base64:wire.transaction_base64,
      last_valid_block_height:wire.last_valid_block_height,batch_id:row.id,order_id:orderId,...expected};
  }
  function summary(v,a) {
    const out={batch_address:a.batch.toBase58(),vault_address:a.vault.toBase58(),
      seller_payment_wallet:v.sellerPaymentWallet.toBase58(),frozen:v.frozen,
      manual_settlement:v.manualSettlement,advance_claimed:v.advanceClaimed,balance_claimed:v.balanceClaimed,
      advance_eligible_at:iso(v.advanceEligibleAt),balance_eligible_at:iso(v.balanceEligibleAt)};
    for(const [key,field] of Object.entries({total_deposited:'totalDeposited',total_cancelled:'totalCancelled',
      total_topups:'totalTopups',total_admin_refunded:'totalAdminRefunded',total_seller_paid:'totalSellerPaid',
      total_redirected:'totalRedirected',admin_sequence:'adminSequence'}))out[key]=v[field].toString();
    return out;
  }
  async function syncOrder(order,minSlot) {
    const {data:r,slot}=await chain.receipt(order.batch_id,order.id,minSlot);
    const a=chain.addresses(order.batch_id,order.id);
    ensure(r.buyer.equals(pub(order.buyer_wallet))&&r.vault.equals(a.vault)
      &&Buffer.from(r.orderId).equals(uuidBytes(order.id))
      &&Buffer.from(r.pickupLocationId).equals(uuidBytes(order.pickup_location_id))
      &&r.quantity===order.quantity&&r.amountPaid.toString()===String(order.amount_lamports),'CHAIN_ORDER_MISMATCH');
    const value={...order,order_address:a.order.toBase58(),vault_address:a.vault.toBase58(),
      purchased_at:iso(r.purchasedAt),cancel_until:iso(r.cancelUntil),cancelled:r.cancelled,
      refunded_lamports:r.refundedLamports.toString()};
    await rpc('record_chain_order',{p_order:value,p_slot:slot});
    return result(db.from('chain_orders').select('*').eq('id',order.id).single());
  }
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');
    if(!enabled)return res.status(503).json({error:'CHAIN_INTEGRATION_DISABLED'});next();});
  router.get('/status',run(async(req,res)=>{
    await result(db.from('chain_intents').select('id').limit(1));
    res.json({status:'ready',...await chain.readiness()});
  }));
  router.use(requireAuth);
  router.use(async(req,res,next)=>{
    try {
      await chain.network();
      const user=await result(db.from('users').select('id,wallet_address').eq('id',req.auth.userId).maybeSingle());
      ensure(user&&user.wallet_address===req.auth.walletAddress,'INVALID_OR_EXPIRED_SESSION',401);
      next();
    }catch(e){res.status(e.status||503).json({error:e.status?e.message:'ACCOUNT_CHECK_UNAVAILABLE'});}
  });
  router.post('/batches/:id/initialize/prepare',run(async(req,res)=>{
    exactBody(req.body,['expected_revision','unit_price_lamports','prices_by_size_lamports']);
    ensure(Number.isSafeInteger(req.body.expected_revision)&&req.body.expected_revision>0,'EXPECTED_REVISION_REQUIRED',400);
    await chain.readiness();
    // Validate the payment key before reserving/locking the draft.
    const before=await batch(req.params.id);await managed(before,req.auth);
    const brand=await result(db.from('brands').select('payment_wallet_address').eq('id',before.edition.brand_id).single());
    pub(brand.payment_wallet_address);
    const row=await rpc('reserve_chain_batch',{p_user_id:req.auth.userId,p_wallet:req.auth.walletAddress,
      p_batch_id:uuid(req.params.id),p_revision:req.body.expected_revision,p_pricing:pricing(req.body)});
    const a=chain.addresses(row.id);
    ensure(await chain.clock()<Math.floor(Date.parse(row.opens_at)/1000),'BATCH_OPENING_HAS_PASSED');
    res.json(await prepare(req.auth,row,'initialize',await chain.initialize(row),{
      revision:row.revision,batch_address:a.batch.toBase58(),vault_address:a.vault.toBase58(),
      payment_wallet:row.chain_terms.payment_wallet,pricing:row.chain_terms.pricing}));
  }));
  router.post('/batches/:id/purchase/prepare',run(async(req,res)=>{
    exactBody(req.body,['order_id','quantity','size','pickup_location_id']);
    const row=await batch(req.params.id);
    ensure(row&&row.is_active&&row.chain_status==='initialized','BATCH_NOT_AVAILABLE',404);
    const orderId=uuid(req.body.order_id);
    const choice={pickup_location_id:uuid(req.body.pickup_location_id),quantity:req.body.quantity,size:req.body.size??null};
    const paid=await result(db.from('chain_orders').select('id').eq('id',orderId).maybeSingle());
    ensure(!paid,'ORDER_ALREADY_RECORDED');
    await chain.readiness();
    const quote=await chain.purchase(row,req.auth.walletAddress,orderId,choice);
    await rpc('reserve_chain_order',{p_order_id:orderId,p_user_id:req.auth.userId,p_wallet:req.auth.walletAddress,
      p_batch_id:row.id,p_choice:{...choice,amount_lamports:quote.expected.amount_lamports}});
    res.json(await prepare(req.auth,row,'purchase',[quote.ix],quote.expected,orderId));
  }));
  router.get('/intents/:id',run(async(req,res)=>{
    const i=await intent(req.params.id,req.auth);
    res.json({intent_id:i.id,kind:i.kind,batch_id:i.batch_id,order_id:i.order_id,
      transaction_base64:i.transaction_base64,last_valid_block_height:i.last_valid_block_height,
      signature:i.signature,confirmed_at:i.confirmed_at,...i.expected});
  }));
  router.post('/intents/:id/submit',run(async(req,res)=>{
    exactBody(req.body,['signed_transaction_base64']);
    const i=await intent(req.params.id,req.auth);
    const signature=await chain.submit(i,req.body.signed_transaction_base64);
    // Submission is not financial confirmation. Client must call /confirm.
    res.status(202).json({signature,intent_id:i.id,status:'submitted'});
  }));
  router.post('/intents/:id/confirm',run(async(req,res)=>{
    exactBody(req.body,['signature']);
    ensure(req.body.signature===undefined||typeof req.body.signature==='string','INVALID_SIGNATURE',400);
    const i=await intent(req.params.id,req.auth);
    const signature=req.body.signature||await chain.recoverSignature(i);
    ensure(!i.signature||i.signature===signature,'INTENT_SIGNATURE_CONFLICT');
    const tx=await chain.verify(i,signature);
    const row=await batch(i.batch_id);
    let order=null;
    if(i.kind==='initialize') {
      await chain.validateBatch(row,tx.slot);
      const a=chain.addresses(row.id);
      await rpc('confirm_chain_batch',{p_batch_id:row.id,p_batch_address:a.batch.toBase58(),
        p_vault_address:a.vault.toBase58(),p_signature:signature,p_revision:i.expected.revision});
    }else if(i.kind==='purchase') {
      order=await syncOrder({id:i.order_id,batch_id:i.batch_id,user_id:i.user_id,buyer_wallet:i.wallet_address,
        ...i.expected,purchase_signature:signature},tx.slot);
    }else if(i.kind==='cancel'||i.kind==='refund') {
      const stored=await result(db.from('chain_orders').select('*').eq('id',i.order_id).single());
      order=await syncOrder(stored,tx.slot);
    }
    await result(db.from('chain_intents').update({signature,confirmed_at:new Date().toISOString()}).eq('id',i.id));
    res.json({status:'confirmed',intent_id:i.id,signature,...(order?{order}:{})});
  }));
  router.get('/orders/mine',run(async(req,res)=>{
    const orders=await result(db.from('chain_orders').select('*').eq('user_id',req.auth.userId)
      .eq('buyer_wallet',req.auth.walletAddress).order('created_at',{ascending:false}).limit(100));
    res.json({orders});
  }));
  router.get('/orders/:id',run(async(req,res)=>{
    const order=await ownOrder(req.params.id,req.auth);
    res.json({order:await syncOrder(order)});
  }));
  router.post('/orders/:id/cancel/prepare',run(async(req,res)=>{
    exactBody(req.body,[]);
    const order=await syncOrder(await ownOrder(req.params.id,req.auth));
    ensure(!order.cancelled&&await chain.clock()<Date.parse(order.cancel_until)/1000,'CANCELLATION_UNAVAILABLE');
    const row=await batch(order.batch_id);
    const ix=await chain.simple(row,req.auth.walletAddress,'cancel',{order_id:order.id});
    res.json(await prepare(req.auth,row,'cancel',[ix],{},order.id));
  }));
  router.post('/orders/:id/collected',run(async(req,res)=>{
    exactBody(req.body,[]);
    const order=await syncOrder(await ownOrder(req.params.id,req.auth));
    ensure(!order.cancelled&&BigInt(order.refunded_lamports)<BigInt(order.amount_lamports),'ORDER_NOT_COLLECTIBLE');
    await result(db.from('chain_orders').update({collected_at:order.collected_at||new Date().toISOString()}).eq('id',order.id));
    res.json({status:'collection_recorded',payment_release_authorized:false});
  }));
  router.post('/orders/:id/report',run(async(req,res)=>{
    exactBody(req.body,['message']);
    ensure(typeof req.body.message==='string'&&req.body.message.trim().length>0&&req.body.message.length<=2000,'INVALID_REPORT',400);
    const order=await syncOrder(await ownOrder(req.params.id,req.auth));
    const row=await batch(order.batch_id);
    ensure(!order.cancelled&&BigInt(order.refunded_lamports)<BigInt(order.amount_lamports),'ORDER_NOT_REPORTABLE');
    ensure(await chain.clock()>=Date.parse(row.release_at)/1000,'REPORTING_NOT_OPEN');
    await result(db.from('chain_reports').upsert({order_id:order.id,user_id:req.auth.userId,message:req.body.message.trim()},{onConflict:'order_id'}));
    res.json({status:'reported',automatic_freeze:false});
  }));
  router.get('/admin/orders/:id',run(async(req,res)=>{
    await admin(req.auth);
    const order=await result(db.from('chain_orders').select('*').eq('id',uuid(req.params.id)).maybeSingle());
    ensure(order,'ORDER_NOT_FOUND',404);
    res.json({order:await syncOrder(order)});
  }));
  router.get('/admin/reports',run(async(req,res)=>{
    await admin(req.auth);
    res.json({reports:await result(db.from('chain_reports').select('*').order('created_at',{ascending:false}).limit(100))});
  }));
  router.get('/batches/:id/orders',run(async(req,res)=>{
    const row=await batch(req.params.id);await managed(row,req.auth);
    res.json({orders:await result(db.from('chain_orders').select('*').eq('batch_id',row.id).order('created_at',{ascending:false}).limit(100))});
  }));
  router.get('/batches/:id/escrow',run(async(req,res)=>{
    const row=await batch(req.params.id);ensure(row&&row.chain_status==='initialized','BATCH_NOT_FOUND',404);
    const v=await chain.validateBatch(row);
    res.json({escrow:summary(v.vault,v.addresses)});
  }));
  router.post('/batches/:id/actions/prepare',run(async(req,res)=>{
    exactBody(req.body,['action','amount_lamports','recipient','reason','order_id']);
    const kind=req.body.action;
    ensure(['advance','balance','topup',...ADMIN_ACTIONS].includes(kind),'INVALID_ACTION',400);
    const row=await batch(req.params.id);ensure(row&&row.chain_status==='initialized','BATCH_NOT_FOUND',404);
    if(ADMIN_ACTIONS.includes(kind))await admin(req.auth);
    // Claims are permissionless on-chain, but this seller-facing endpoint checks membership.
    if(kind==='advance'||kind==='balance')await managed(row,req.auth);
    const input={...req.body};
    if(kind==='refund') {
      input.order_id=uuid(input.order_id);
      const o=await result(db.from('chain_orders').select('batch_id').eq('id',input.order_id).maybeSingle());
      ensure(o&&o.batch_id===row.id,'ORDER_NOT_FOUND',404);
    }
    const ix=await chain.simple(row,req.auth.walletAddress,kind,input);
    res.json(await prepare(req.auth,row,kind,[ix],input,kind==='refund'?input.order_id:null));
  }));
  return router;
};
