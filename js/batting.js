const VSP_TXT = {R:"右投", L:"左投", M:"混合", "":"-"};
const BKEYS = ["AB","H","d2","d3","HR","BB","SF","R","RBI","SO","SB"];
function batSplitAgg(games, pid){
  const mk = ()=>({AB:0,H:0,d2:0,d3:0,HR:0,BB:0,SF:0,gp:0});
  const r = {R:mk(), L:mk()};
  games.forEach(g=>(g.batting||[]).forEach(l=>{
    if(l.pid!==pid) return;
    const key = l.vsP==="R"?"R":l.vsP==="L"?"L":null;
    if(!key) return;
    r[key].gp++;
    ["AB","H","d2","d3","HR","BB","SF"].forEach(k=>r[key][k]+=(l[k]||0));
  }));
  finishBat(r.R); finishBat(r.L);
  return r;
}
function battingAgg(games){
  const map = {};
  games.forEach(g => (g.batting||[]).forEach(l => {
    const m = map[l.pid] = map[l.pid] || {gp:0,AB:0,H:0,d2:0,d3:0,HR:0,BB:0,SF:0,R:0,RBI:0,SO:0,SB:0};
    m.gp++; BKEYS.forEach(k => m[k]+= (l[k]||0));
  }));
  Object.values(map).forEach(m => finishBat(m));
  return map;
}
function finishBat(m){
  m.TB = (m.H - m.d2 - m.d3 - m.HR) + 2*m.d2 + 3*m.d3 + 4*m.HR;
  m.PA = m.AB + m.BB + m.SF;
  m.AVG = m.AB ? m.H/m.AB : NaN;
  m.OBP = m.PA ? (m.H+m.BB)/m.PA : NaN;
  m.SLG = m.AB ? m.TB/m.AB : NaN;
  m.OPS = (isFinite(m.OBP)||isFinite(m.SLG)) ? (isFinite(m.OBP)?m.OBP:0)+(isFinite(m.SLG)?m.SLG:0) : NaN;
  return m;
}
function sumBat(map){
  const t = {AB:0,H:0,d2:0,d3:0,HR:0,BB:0,SF:0,R:0,RBI:0,SO:0,SB:0};
  Object.values(map).forEach(m => Object.keys(t).forEach(k => t[k]+=m[k]));
  return finishBat(t);
}
