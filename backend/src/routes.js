"use strict";
// Legacy custody cannot be re-enabled by an environment toggle. No old signing
// modules or private-wallet lookup are loaded into the new runtime.
const router=require('express').Router();
router.use('/wallet',(_req,res)=>res.status(410).json({error:'LEGACY_CUSTODY_DISABLED'}));
for(const route of ['/orders/confirm','/orders/register','/orders/delivery']) {
  router.use(route,(_req,res)=>res.status(410).json({error:'USE_VERIFIED_CHAIN_ORDER_ROUTES'}));
}
module.exports=router;
