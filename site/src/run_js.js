// node tests/run_js.js <scenarios.json> <out.json> : runs the JS engine on each scenario
const fs=require('fs'),E=require('../site/js/engine.js');
const [,,inp,out]=process.argv; const S=JSON.parse(fs.readFileSync(inp));
const data={},cur=JSON.parse(fs.readFileSync('site/data/current_us.json')).lines,gdp=JSON.parse(fs.readFileSync('site/data/gdp.json'));
const res=S.map(s=>{data[s.year]=data[s.year]||JSON.parse(fs.readFileSync(`site/data/usa_${s.year}.json`));
 return E.compute(data[s.year],gdp[String(s.year)],cur,{mode:s.mode,lines:s.lines},s.elasticity);});
fs.writeFileSync(out,JSON.stringify(res));
