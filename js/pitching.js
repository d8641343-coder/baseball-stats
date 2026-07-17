const VSB_TXT = {R:"右打為主", L:"左打為主", M:"混合", "":"-"};
function pitSplitAgg(games, pid){
  const mk = ()=>({outs:0,H:0,R:0,ER:0,BB:0,SO:0,gp:0,wER:0,GO:0,AO:0});
  const r = {R:mk(), L:mk()};
  games.forEach(g=>(g.pitching||[]).forEach(l=>{
    if(l.pid!==pid) return;
    const key = l.vsB==="R"?"R":l.vsB==="L"?"L":null;
    if(!key) return;
    r[key].gp++; r[key].outs+=(l.outs||0);
    r[key].wER += (l.ER||0) * eraBaseOf(g.level);
    ["H","R","ER","BB","SO","GO","AO"].forEach(k=>r[key][k]+=(l[k]||0));
  }));
  finishPit(r.R); finishPit(r.L);
  return r;
}

/* ───────── 統計計算 ───────── */
function pitchingAgg(games){
  const map = {};
  games.forEach(g => (g.pitching||[]).forEach(l => {
    const m = map[l.pid] = map[l.pid] || {gp:0,outs:0,H:0,R:0,ER:0,BB:0,SO:0,wER:0,GO:0,AO:0};
    m.gp++; m.outs += (l.outs||0);
    m.wER += (l.ER||0) * eraBaseOf(g.level);
    ["H","R","ER","BB","SO","GO","AO"].forEach(k => m[k]+= (l[k]||0));
  }));
  Object.values(map).forEach(m => finishPit(m));
  return map;
}
function eraBaseOf(level){
  const b = state.eraBases || {...ERA_BASE_DEFAULT};
  return b[level] || b["其他"] || 9;
}
function finishPit(m){
  const ip = m.outs/3;
  const wER = (m.wER !== undefined) ? m.wER : m.ER * 9;
  m.ERA = ip ? wER / ip : (m.ER>0 ? Infinity : NaN);
  m.WHIP = ip ? (m.H+m.BB)/ip : NaN;
  m.K9 = ip ? m.SO*9/ip : NaN;
  m.BB9 = ip ? m.BB*9/ip : NaN;
  m.GOAO = (m.AO||0) > 0 ? (m.GO||0)/m.AO : ((m.GO||0) > 0 ? Infinity : NaN);
  return m;
}
function sumPit(map){
  const t = {outs:0,H:0,R:0,ER:0,BB:0,SO:0,wER:0,GO:0,AO:0};
  Object.values(map).forEach(m => Object.keys(t).forEach(k => t[k]+=(m[k]||0)));
  return finishPit(t);
}
