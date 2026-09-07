const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const base = 'a'.repeat(40), head = 'b'.repeat(40), nextBase = 'c'.repeat(40);
const main = fs.readFileSync(require('node:path').join(__dirname,'../workflows/claude.yml'),'utf8');
const companion = fs.readFileSync(require('node:path').join(__dirname,'../workflows/claude-review-cancelled.yml'),'utf8');
const blocks = text => [...text.matchAll(/node <<'NODE'\r?\n([\s\S]*?)          NODE/g)].map(m=>m[1].replace(/^          /gm,''));
const mainBlocks = blocks(main);
const policyLoader = mainBlocks.find(block => block.includes('Applicable AGENTS.md candidate count'));
const packet = mainBlocks.find(block => block.includes('fs.writeFileSync(process.env.PROMPT_FILE'));
const receipt = mainBlocks.find(block => block.includes('factory-os:review-receipt-parser:start'));
const companionReceipt = blocks(companion)[0];
assert(policyLoader && packet && receipt && companionReceipt);
assert(packet.includes('const compare')); assert(receipt.includes('RECEIPT_TEST_MODE'));
assert(main.indexOf('Mark exact-head review pending') > main.indexOf('  claude-review:'), 'pending belongs to the discoverable exact-head job');
assert(main.includes("github.triggering_actor == 'nikejshah' && ("), 'reruns require the owner as triggering actor');
assert(main.includes("github.event.action == 'edited' && github.event.changes.base != null"), 'base edits trigger a fresh owner review');
assert(main.includes('reviewed_base'), 'receipts bind the reviewed base');
function compareJson(files=[{filename:'a.ts',patch:'DO NOT DUPLICATE',status:'modified'}]) {
  return JSON.stringify({base_commit:{sha:base},status:'ahead',commits:[{sha:head}],total_commits:1,files});
}
async function policyTest(overrides={}) {
  let output = '';
  const values = { compare: compareJson([{filename:'desk/src/a.ts',previous_filename:'legacy/a.ts',status:'renamed'}]), ...overrides };
  const hits = [];
  const context = {
    Buffer,
    require: () => ({
      readFileSync: path => values[path],
      writeFileSync: (_path, value) => { output = value; },
    }),
    process: { env: { COMPARE_FILE:'compare', POLICY_FILE:'policy', API_URL:'https://mock.test', REPOSITORY:'owner/repo', BASE_SHA:base, GITHUB_TOKEN:'token' } },
    console,
    fetch: async (url) => {
      hits.push(url);
      const path = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
      const body = { 'AGENTS.md':'root policy', 'desk/AGENTS.md':'desk policy', 'desk/src/AGENTS.md':'src policy', 'legacy/AGENTS.md':'legacy policy' }[path];
      return body === undefined ? {status:404, ok:false} : {status:200, ok:true, text:async()=>body};
    },
  };
  const result = vm.runInNewContext(policyLoader, context);
  if (result && typeof result.then === 'function') await result;
  assert.equal(context.process.exitCode, undefined);
  return { output, hits };
}
async function policyFails(overrides={}) {
  const values = { compare: compareJson(), ...overrides };
  const context = {Buffer,require:()=>({readFileSync:path=>values[path],writeFileSync:()=>{}}),process:{env:{COMPARE_FILE:'compare',POLICY_FILE:'policy',API_URL:'https://mock.test',REPOSITORY:'owner/repo',BASE_SHA:base,GITHUB_TOKEN:'token'}},console:{error:()=>{},log:()=>{}},fetch:async()=>({status:404,ok:false})};
  const result = vm.runInNewContext(policyLoader, context);
  if (result && typeof result.then === 'function') await result;
  assert.equal(context.process.exitCode, 1);
}
function packetTest(overrides={}) {
  let output;
  const values = { compare:compareJson(),diff:'diff --git a/a.ts b/a.ts\n+safe\n',policy:'Review correctness',...overrides };
  vm.runInNewContext(packet,{Buffer,require:()=>({readFileSync:path=>values[path],writeFileSync:(_path,value)=>{output=value;}}),process:{env:{COMPARE_FILE:'compare',DIFF_FILE:'diff',POLICY_FILE:'policy',BASE_SHA:base,HEAD_SHA:head,PR_NUMBER:'4',PROMPT_FILE:'prompt',INPUT_FOCUS:'review'}}});
  return output;
}
function receiptTest(payload, outcome='success', env={}) {
  let output=''; const processMock={env:{RECEIPT_TEST_MODE:'1',EXPECTED_BASE:base,EXPECTED_HEAD:head,ACTION_OUTCOME:outcome,STRUCTURED_OUTPUT:JSON.stringify(payload),DETAILS_URL:'https://example.test/run/1',...env},stdout:{write:value=>{output+=value;}}};
  vm.runInNewContext(receipt,{require:()=>fs,process:processMock,console});
  return {result:JSON.parse(output),code:processMock.exitCode};
}
async function companionTest(jobName,title,liveHead=head,liveBase=base,newerActor=null,newerJob=true,primary=false,triggeringActor='nikejshah') {
  const posts=[];
  await vm.runInNewContext(primary ? receipt : companionReceipt,{require:()=>fs,console:{error:()=>{},log:()=>{}},process:{stdout:{write:()=>{}},env:{EXPECTED_BASE:base,EXPECTED_HEAD:head,PR_NUMBER:'4',CURRENT_RUN_ID:'1',ACTION_OUTCOME:'success',STRUCTURED_OUTPUT:JSON.stringify({verdict:'PASS',reviewed_base:base,reviewed_head:head,summary:'ok',report:''}),GITHUB_API_URL:'https://mock.test',GITHUB_REPOSITORY:'owner/repo',DISPLAY_TITLE:title,DETAILS_URL:'https://mock.test/run/1',FAILED_RUN_ID:'1',FAILED_EVENT:'pull_request',FAILED_CONCLUSION:'failure',RUN_ACTOR:'nikejshah',TRIGGERING_ACTOR:triggeringActor}} ,fetch:async(url,options={})=>{
    if(options.method==='POST'){posts.push({url,body:JSON.parse(options.body)});return {ok:true};}
    const exactJob = `claude-review-pr-4-base-${base}-head-${head}`;
    const data=url.includes('/runs/2/jobs?')?{jobs:newerJob?[{name:exactJob}]:[]}:url.includes('/jobs?')?{jobs:jobName?[{name:jobName}]:[]}:url.includes('/workflows/')?{workflow_runs:newerActor?[{id:2,actor:{login:newerActor},triggering_actor:{login:newerActor},display_title:`Claude review PR #4 @ ${head}`}]:[]}:url.includes('/commits/')?{statuses:[]}: {base:{sha:liveBase},head:{sha:liveHead}};
    return {ok:true,json:async()=>data,headers:{get:()=>''}};
  }});
  return posts;
}
(async()=>{
  const loaded = await policyTest();
  assert(loaded.output.includes('AGENTS.md @'));
  assert(loaded.output.includes('root policy'));
  assert(loaded.output.includes('desk policy'));
  assert(loaded.output.includes('src policy'));
  assert(loaded.output.includes('legacy policy'));
  assert(loaded.hits.some(url=>url.includes('/contents/desk/src/AGENTS.md?')));
  await policyTest({compare:compareJson([{filename:'space dir/a.ts',status:'modified'}])});
  await policyFails({compare:compareJson([{filename:'../escape.ts',status:'modified'}])});
  await policyFails({compare:compareJson(Array.from({length:40},(_,i)=>({filename:Array.from({length:19},(_,j)=>`d${i}-${j}`).join('/') + '/a.ts',status:'modified'})))});
  assert(!packetTest().includes('DO NOT DUPLICATE'));
  assert(packetTest({compare:JSON.stringify({base_commit:{sha:base},status:'diverged',commits:[{sha:head}],total_commits:1,files:[{filename:'a.ts',status:'modified'}]})}).includes(head));
  assert(packetTest({policy:'nested policy'}).includes('reviewed_base'));
  assert.throws(()=>packetTest({policy:'x'.repeat(12001)}),/policy|AGENTS/i);
  assert.throws(()=>packetTest({diff:'diff --git a/a.ts b/a.ts\nBinary files differ\n'}),/textual/);
  assert.throws(()=>packetTest({diff:'diff --git a/a.ts b/a.ts\n'+'x'.repeat(800001)+'\n'}),/bound/);
  assert.throws(()=>packetTest({diff:'truncated'}),/truncated/);
  assert.equal(receiptTest({verdict:'PASS',reviewed_base:base,reviewed_head:head,summary:'ok',report:''}).result.state,'success');
  assert.equal(receiptTest({verdict:'PASS',reviewed_base:nextBase,reviewed_head:head,summary:'ok',report:''}).result.state,'failure');
  assert.match(receiptTest({verdict:'BLOCK',reviewed_base:base,reviewed_head:head,summary:'issue',report:''}).result.description,/empty/);
  assert.equal(receiptTest({verdict:'PASS',reviewed_base:base,reviewed_head:base,summary:'ok',report:''}).result.state,'failure');
  assert.equal(receiptTest({verdict:'PASS',reviewed_base:base,reviewed_head:head,summary:'ok',report:''},'failure').result.state,'failure');
  const exactJob = `claude-review-pr-4-base-${base}-head-${head}`;
  assert.equal((await companionTest(exactJob,'Claude review PR #4 @ resolve-head')).filter(p=>p.url.includes('/statuses/')).length,1);
  assert.equal((await companionTest(null,'Claude review PR #4 @ resolve-head')).filter(p=>p.url.includes('/statuses/')).length,0);
  assert.equal((await companionTest(exactJob,'Claude review PR #4 @ resolve-head',base,base)).filter(p=>p.url.includes('/statuses/')).length,0);
  assert.equal((await companionTest(exactJob,'Claude review PR #4 @ resolve-head',head,nextBase)).filter(p=>p.url.includes('/statuses/')).length,0);
  assert.equal((await companionTest(exactJob,'Claude review PR #4 @ resolve-head',head,nextBase,null,true,true)).filter(p=>p.url.includes('/statuses/')).length,0);
  assert.equal((await companionTest(exactJob,'Claude review PR #4 @ resolve-head',head,base,null,true,false,'outsider')).length,0, 'non-owner rerun actors cannot publish failure receipts');
  for(const primary of [false,true]) {
    const run = (actor,job) => companionTest(exactJob,'Claude review PR #4 @ resolve-head',head,base,actor,job,primary);
    assert.equal((await run('outsider',true)).filter(p=>p.url.includes('/statuses/')).length,1, 'unauthorized newer runs cannot suppress a receipt');
    assert.equal((await run('nikejshah',false)).filter(p=>p.url.includes('/statuses/')).length,1, 'a title alone cannot suppress a receipt');
    assert.equal((await run('nikejshah',true)).filter(p=>p.url.includes('/statuses/')).length,0, 'newer authorized exact base/head jobs supersede old receipts');
  }
  console.log('Actual workflow inline packet, policy, receipt and companion regression probes passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
