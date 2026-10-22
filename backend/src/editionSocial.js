'use strict';
const defaults={whatsapp:'',instagram:'',twitter:'',support_email:''};
function normalizeSocialLinks(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!Object.hasOwn(defaults,k))) throw new Error('INVALID_SOCIAL_LINKS');
  const out={...defaults};
  for(const [key,raw] of Object.entries(value)) {
    if(typeof raw!=='string') throw new Error('INVALID_SOCIAL_LINKS');
    const v=raw.trim();
    if(v.length>320 || /[\u0000-\u001f\u007f]/.test(v)) throw new Error('INVALID_SOCIAL_LINKS');
    if(v && key==='whatsapp' && !/^\+[1-9]\d{7,14}$/.test(v)) throw new Error('INVALID_SOCIAL_LINKS');
    if(v && key==='support_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('INVALID_SOCIAL_LINKS');
    if(v && ['instagram','twitter'].includes(key)) {
      let u;try{u=new URL(v)}catch{throw new Error('INVALID_SOCIAL_LINKS')}
      const hosts=key==='instagram'?['instagram.com','www.instagram.com']:['x.com','www.x.com','twitter.com','www.twitter.com'];
      if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.username||u.password||u.port||u.href.length>320) throw new Error('INVALID_SOCIAL_LINKS');
      out[key]=u.href;
      continue;
    }
    out[key]=v;
  }
  return out;
}
module.exports={normalizeSocialLinks};