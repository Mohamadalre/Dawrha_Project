const io=require('socket.io-client');
const fs=require('fs');
const token=fs.readFileSync('citoken.txt','utf8').trim();
const socket=io('http://abd.softup.agency:5902/collection',{auth:{token},transports:['websocket'],timeout:20000});
function test(lat,lng,label){
  return new Promise((res)=>{
    const s=io('http://abd.softup.agency:5902/collection',{auth:{token},transports:['websocket']});
    s.on('connect',()=>{ s.emit('user:nearby_drivers',{lat,lng,radius_km:10},(err,resp)=>{ s.close(); res({label,err,resp}); }); });
    s.on('exception',e=>{ s.close(); res({label,exception:e}); });
    s.on('connect_error',e=>{ res({label,connerr:e.message}); });
    setTimeout(()=>{ s.close(); res({label,timeout:true}); },15000);
  });
}
(async()=>{
  const r1=await test(0,0,'no-coverage (0,0)');
  console.log('R1', JSON.stringify(r1).slice(0,400));
  const r2=await test(33.5138,36.2765,'with-coverage (33.5,36.2)');
  console.log('R2', JSON.stringify(r2).slice(0,400));
  process.exit(0);
})();
