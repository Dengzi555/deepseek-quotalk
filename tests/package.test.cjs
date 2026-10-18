const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('extension package is complete, self-contained, and limited to DeepSeek',()=>{
  const m=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));
  assert.equal(m.manifest_version,3);
  assert.deepEqual(m.permissions.sort(),['activeTab','storage']);
  for(const entry of m.content_scripts)assert.deepEqual(entry.matches,['https://chat.deepseek.com/*']);
  assert.equal(m.content_scripts.find(entry=>entry.world==='MAIN').run_at,'document_start');
  for(const f of [m.background.service_worker,...m.content_scripts.flatMap(entry=>entry.js)]){
    const source=fs.readFileSync('extension/'+f,'utf8');
    assert.doesNotThrow(()=>new vm.Script(source,{filename:f}));
    assert.doesNotMatch(source,/https:\/\/(?!chat\.deepseek\.com|github\.com\/(?:PC2005-cloud\/dsh-pet|Refining-colors\/pet-with-you))/);
  }
  assert.equal(fs.existsSync('extension/mock.js'),false);
  assert.deepEqual(m.web_accessible_resources,[{resources:['assets/deepseek-whale-blue.svg','assets/pet-with-you/poster.svg','assets/pet-with-you/*.webm'],matches:['https://chat.deepseek.com/*']}]);
  for(const file of m.web_accessible_resources[0].resources.filter(f=>!f.includes('*')))assert.ok(fs.existsSync('extension/'+file));
  const ctx={};vm.runInNewContext(fs.readFileSync('extension/pet-catalog.js','utf8'),ctx);
  const catalog=ctx.MarginPetCatalog,actions=catalog.groups.flatMap(g=>g.actions);
  assert.equal(actions.length,100);assert.equal(new Set(actions.map(a=>a.id)).size,100);
  assert.ok(actions.every(a=>!a.label.includes('余额')));
  for(const action of actions){assert.match(action.file,/^assets\/pet-with-you\/a\d{3}\.webm$/);assert.equal(fs.readFileSync('extension/'+action.file).subarray(0,4).toString('hex'),'1a45dfa3');}
  assert.ok(actions.some(a=>a.id===catalog.idle));assert.ok(actions.some(a=>a.id===catalog.thinking));
  for(const name of ['LICENSE','LICENSE.upstream','ATTRIBUTION.md','sources.json'])assert.ok(fs.existsSync('extension/assets/pet-with-you/'+name));
  assert.match(fs.readFileSync('extension/assets/deepseek-whale-blue.svg','utf8'),/#4D6BFE/);
  assert.doesNotMatch(fs.readFileSync('extension/ui.js','utf8'),/brightness\(0\) invert\(1\)/);
});
