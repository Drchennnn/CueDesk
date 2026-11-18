'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const RATE=16000;
function header(bytes,channels=1){const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(36+bytes,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(RATE,24);b.writeUInt32LE(RATE*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(bytes,40);return b;}
function createSessionAudio({directory,now=Date.now}){
 let active=null,last=null;
 function status(){const r=active||last;return r?{recording:!!active,directory:r.dir,error:r.error||null,startedAt:r.start,finished:r.finished||false}: {recording:false};}
 function start(info={}){
  if(active)throw Error('上一段录音尚未结束');
  const start=now(),name=new Date(start).toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
  const dir=path.join(directory,name);fs.mkdirSync(dir,{recursive:true});
  const r={dir,start,info,error:null,pending:0,queue:Promise.resolve(),tracks:{},finished:false};
  try{for(const c of ['them','me']){const file=path.join(dir,c==='them'?'面试官-系统音频.wav':'本人-原始麦克风.wav');const fd=fs.openSync(file,'wx+');fs.writeSync(fd,header(0));r.tracks[c]={file,fd,end:0,written:0,frames:0};}}
  catch(e){for(const t of Object.values(r.tracks))fs.closeSync(t.fd);throw e;}
  active=r;last=r;save(r);return status();
 }
 function save(r){fs.writeFileSync(path.join(r.dir,'录音信息.json'),JSON.stringify({sampleRate:RATE,format:'PCM signed 16-bit',startedAt:r.start,stoppedAt:r.stoppedAt||null,session:r.info,finished:r.finished,error:r.error,channels:{left:'系统播放音频（可能包含其他应用声音）',right:'本人原始麦克风（外放串音也会保留）'},microphoneAsr:false,timestampMeaning:'PCM帧送达时间近似定位；不是声学精确时间戳',frames:Object.fromEntries(Object.entries(r.tracks).map(([k,t])=>[k,t.frames]))},null,2));}
 function push(channel,raw,ts){
  const r=active;if(!r||r.error)return false;const t=r.tracks[channel];if(!t)return false;
  const values=raw instanceof ArrayBuffer?new Float32Array(raw):ArrayBuffer.isView(raw)?new Float32Array(raw.buffer,raw.byteOffset,Math.floor(raw.byteLength/4)):null;
  if(!values||!values.length)return false;
  const b=Buffer.alloc(values.length*2);for(let i=0;i<values.length;i++)b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,Number.isFinite(values[i])?values[i]:0))*32767),i*2);
  if(r.pending+b.length>2*1024*1024){r.error='磁盘写入积压，录音已停止接收；已录部分仍会保存';save(r);return false;}
  const at=Number.isFinite(ts)?ts:now(),offset=Math.max(t.end,Math.max(0,Math.round((at-r.start)*RATE/1000)-values.length));
  if((offset+values.length)*2>0x70000000){r.error='单次录音超过WAV文件大小限制，请停止并重新开始';save(r);return false;}
  t.end=offset+values.length;r.pending+=b.length;
  r.queue=r.queue.then(async()=>{let n=0;while(n<b.length){const written=await new Promise((resolve,reject)=>fs.write(t.fd,b,n,b.length-n,44+offset*2+n,(e,count)=>e?reject(e):resolve(count)));if(!written)throw Error('音频写入未完成');n+=written;}t.written=Math.max(t.written,offset*2+b.length);t.frames++;}).catch(e=>{r.error='录音写入失败：'+e.message;}).finally(()=>{r.pending-=b.length;});
  return true;
 }
 async function stop(){
  const r=active;if(!r)return status();if(r.stopping)return r.stopping;
  r.stopping=(async()=>{r.stoppedAt=now();await r.queue;
   for(const t of Object.values(r.tracks)){try{fs.writeSync(t.fd,header(t.written),0,44,0);fs.ftruncateSync(t.fd,44+t.written);}finally{fs.closeSync(t.fd);}}
   try{await stereo(r);}catch(e){r.error=(r.error?r.error+'；':'')+'双声道合成失败，分轨仍保留：'+e.message;}
   r.finished=true;save(r);active=null;return status();
  })();return r.stopping;
 }
 async function stereo(r){
  const bytes=Math.max(...Object.values(r.tracks).map(t=>t.written)),out=await fs.promises.open(path.join(r.dir,'完整回听-左对方右本人.wav'),'wx');
  const inputs=await Promise.all(Object.values(r.tracks).map(t=>fs.promises.open(t.file,'r')));
  try{await out.writeFile(header(bytes*2,2));for(let pos=0;pos<bytes;pos+=32768){const size=Math.min(32768,bytes-pos),pair=[Buffer.alloc(size),Buffer.alloc(size)];await Promise.all(inputs.map((f,i)=>f.read(pair[i],0,size,44+pos)));const merged=Buffer.alloc(size*2);for(let n=0;n<size/2;n++){merged.writeInt16LE(pair[0].readInt16LE(n*2),n*4);merged.writeInt16LE(pair[1].readInt16LE(n*2),n*4+2);}await out.writeFile(merged);}}
  finally{await Promise.all(inputs.map(f=>f.close()));await out.close();}
 }
 return {start,push,stop,status};
}
module.exports={createSessionAudio,header};
