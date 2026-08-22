const http=require('http');
const fs=require('fs');
const token=fs.readFileSync('citoken.txt','utf8').trim();
function req(path){return new Promise((res)=>{const u=new URL('http://abd.softup.agency:5902/api/v1'+path);const h={'Content-Type':'application/json','Authorization':'Bearer '+token};const r=http.request(u,{method:'GET',headers:h},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res({...JSON.parse(d),_s:x.statusCode})}catch{res({raw:d,_s:x.statusCode})}})});r.on('error',e=>res({err:e.message}));r.setTimeout(15000,()=>{r.destroy();res({err:'timeout'})});r.end()})}
(async()=>{
  const r=await req('/user/coverage-zones?lat=0&lng=0&radius=10');
  console.log('REST (0,0):', r._s, JSON.stringify(r).slice(0,400));
  const r2=await req('/user/coverage-zones?lat=33.5138&lng=36.2765&radius=10');
  console.log('REST (33.5):', r2._s, JSON.stringify(r2).slice(0,400));
})();
