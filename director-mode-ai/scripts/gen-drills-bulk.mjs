import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY || env.AI_API_KEY });
const MODEL='claude-sonnet-4-6', TARGET=350;
const THEMES=['beginner fundamentals and red/orange/green ball drills','forehand technique and patterns','backhand technique (one and two-handed, slice)','serve variety (flat, slice, kick, placement, serve+1)','return of serve','volleys and net play','overheads and lob handling','doubles tactics and formations','singles strategy and shot selection','movement, footwork and agility','on-court fitness and conditioning','competitive clinic games','approach shots and transition play','specialty/touch shots (drops, angles, defense)','mental game, routines and match-play','group warm-ups','high-performance advanced patterns','mixed-level clinic games'];
const drillSchema={type:'object',properties:{name:{type:'string'},category:{type:'string',enum:['warmup','serve','groundstrokes','volley','overhead','movement','strategy','game','conditioning']},skills:{type:'array',items:{type:'string'}},level:{type:'string',enum:['beginner','intermediate','advanced','all']},min_players:{type:'integer'},max_players:{type:'integer'},duration_min:{type:'integer'},is_game:{type:'boolean'},setup:{type:'string'},instructions:{type:'string'},coaching_points:{type:'string'},progression:{type:'string'},tags:{type:'array',items:{type:'string'}}},required:['name','category','skills','level','min_players','max_players','is_game','setup','instructions','coaching_points']};
const tool={name:'save_drills',description:'Save a batch of tennis drills',input_schema:{type:'object',properties:{drills:{type:'array',items:drillSchema}},required:['drills']}};
let existing=new Set((await admin.from('drills').select('name')).data.map(d=>d.name.toLowerCase()));
console.log('start:',existing.size);
for(let i=0;i<THEMES.length && existing.size<TARGET;i++){
  const avoid=[...existing].slice(-160).join('; ');
  const prompt=`Generate 22 distinct, high-quality, coach-usable tennis drills/games focused on: ${THEMES[i]}. Vary level and player count (1 for private, 2-4 small group, 5-12 clinic). Include several games (is_game true). Each needs a real setup, clear instructions, 1-2 coaching cues, and a progression. Call save_drills with all of them. Do NOT reuse these names: ${avoid}`;
  try{
    const msg=await anthropic.messages.create({model:MODEL,max_tokens:8000,tools:[tool],tool_choice:{type:'tool',name:'save_drills'},messages:[{role:'user',content:prompt}]});
    const tu=msg.content.find(b=>b.type==='tool_use');
    const drills=tu?.input?.drills||[];
    const rows=[];
    for(const d of drills){ if(!d?.name) continue; const k=d.name.toLowerCase().trim(); if(existing.has(k)) continue; existing.add(k); rows.push({name:d.name,category:d.category,skills:d.skills||[],level:d.level,min_players:d.min_players||1,max_players:d.max_players||8,duration_min:d.duration_min||null,is_game:!!d.is_game,setup:d.setup,instructions:d.instructions,coaching_points:d.coaching_points,progression:d.progression||null,tags:d.tags||[]}); }
    if(rows.length){const{error}=await admin.from('drills').insert(rows); if(error){console.log('batch',i+1,'insert err',error.message);rows.forEach(r=>existing.delete(r.name.toLowerCase()));}}
    console.log(`batch ${i+1} [${THEMES[i].slice(0,28)}]: +${rows.length} -> ${existing.size}`);
  }catch(e){console.log('batch',i+1,'failed:',e.message);}
}
console.log('FINAL:',(await admin.from('drills').select('*',{count:'exact',head:true})).count);
