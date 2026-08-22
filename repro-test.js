const http=require('http');
const io=require('socket.io-client');
const fs=require('fs');
function req(method,path,body){return new Promise((res,rej)=>{const u=new URL('http://localhost:3000/api/v1'+path);const h={'Content-Type':'application/json'};const b=body?JSON.stringify(body):null;if(b)h['Content-Length']=Buffer.byteLength(b);const r=http.request(u,{method,headers:h},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res({...JSON.parse(d),_s:x.statusCode})}catch{res({raw:d,_s:x.statusCode})}})});r.on('error',rej);r.setTimeout(20000,()=>{r.destroy();rej(new Error('req timeout'))});if(b)r.write(b);r.end()})}
async function main(){
  let r;
  try { r = await req('POST','/auth/login/user-app',{email:'producer.flow@dawrha.com',password:'Producer@123',deviceId:'77777777-7777-7777-777777777777'}); }
  catch(e){ fs.writeFileSync('repro-out.log','LOGIN ERR '+e.message); return; }
  const token=r.data?.details?.token?.accessToken||r.result?.details?.token?.accessToken;
  fs.writeFileSync('repro-out.log','LOGIN '+r._s+' TOKEN '+(token?'YES':'NO')+'\n');
  if(!token){fs.appendFileSync('repro-out.log',JSON.stringify(r).slice(0,200));return;}
  const socket=io('http://localhost:3000/collection',{auth:{token},transports:['websocket'],timeout:25000});
  socket.on('connect',()=>{fs.appendFileSync('repro-out.log','CONNECTED\n');socket.emit('user:nearby_drivers',{lat:33.5138,lng:36.2765,radius_km:10},(err,resp)=>{fs.appendFileSync('repro-out.log','ACK err='+JSON.stringify(err)+'\nACK resp='+JSON.stringify(resp).slice(0,600)+'\n');process.exit(0)})});
  socket.on('exception',e=>{fs.appendFileSync('repro-out.log','EXCEPTION '+JSON.stringify(e).slice(0,1500)+'\n');process.exit(1)});
  socket.on('connect_error',e=>{fs.appendFileSync('repro-out.log','CONNERR '+e.message+'\n');process.exit(1)});
  setTimeout(()=>{fs.appendFileSync('repro-out.log','TIMEOUT\n');process.exit(1)},30000);
}
main();
