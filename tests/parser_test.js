const P=require('../site/js/parser.js');
const cases=[
 "US puts 10% on India and 25% on autos from everyone",
 "what if the US doubles tariffs on Chinese EVs and India retaliates on almonds",
 "25% on Chinese EVs and India retaliates with 10% on almonds",
 "Mexico and Canada at 25%, China at 60%",
 "10% on everything from the EU except pharmaceuticals",
 "US removes tariffs on Canada",
 "50% on steel and aluminum from all countries except the UK",
 "15% on Vietnam, Thailand and Malaysia electronics",
 "tariffs on India",
 "-10% on China",
 "minus 5% on India and 20% on Mexico",
 "10-25% on steel from China",
];
for(const c of cases){const r=P.parse(c,{});console.log('>',c);console.log(JSON.stringify(r.lines.map(l=>({t:l.targets,p:l.products,r:l.rate,xt:l.exclude_targets,xp:l.exclude_products}))));if(r.warnings.length)console.log('  W:',r.warnings.join(' | '));if(r.notes.length)console.log('  N:',r.notes.join(' | '));}
