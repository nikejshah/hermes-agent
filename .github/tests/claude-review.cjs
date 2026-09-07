const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const base = 'a'.repeat(40), head = 'b'.repeat(40);
const main = fs.readFileSync(require('node:path').join(__dirname,'../workflows/claude.yml'),'utf8');
const companion = fs.readFileSync(require('node:path').join(__dirname,'../workflows/claude-review-cancelled.yml'),'utf8');
const blocks = text => [...text.matchAll(/node <<'NODE'\r?\n([\s\S]*?)          NODE/g)].map(m=>m[1].replace(/^          /gm,''));
const [packet, receipt] = blocks(main);
assert(packet.includes('const compare')); assert(receipt.includes('RECEIPT_TEST_MODE'));
function packetTest(overrides={}) {
  let output;
  const values = { compare:JSON.stringify({base_commit:{sha:base},status:'ahead',commits:[{sha:head}],total_commits:1,files:[{filename:'a.ts',patch:'DO NOT DUPLICATE',status:'modified'}]}),diff:'diff --git a/a.ts b/a.ts\n+safe\n',policy:'Review correctness',...overrides };
  vm.runInNewContext(packet,{Buffer,require:()=>({readFileSync:path=>values[path],writeFileSync:(_path,value)=>{output=value;}}),process:{env:{COMPARE_FILE:'compare',DIFF_FILE:'diff',POLICY_FILE:'policy',BASE_SHA:base,HEAD_SHA:head,PR_NUMBER:'4',PROMPT_FILE:'prompt',INPUT_FOCUS:'review'}}});
  return output;
}
assert(!packetTest().includes('DO NOT DUPLICATE'));
assert(packetTest({compare:JSON.stringify({base_commit:{sha:base},status:'diverged',commits:[{sha:head}],total_commits:1,files:[{filename:'a.ts',status:'modified'}]})}).includes(head));
assert.throws(()=>packetTest({policy:'x'.repeat(12001)}),/policy|AGENTS/i);
assert.throws(()=>packetTest({diff:'diff --git a/a.ts b/a.ts\nBinary files differ\n'}),/textual/);
assert.throws(()=>packetTest({diff:'diff --git a/a.ts b/a.ts\n'+'x'.repeat(800001)+'\n'}),/bound/);
assert.throws(()=>packetTest({diff:'truncated'}),/truncated/);
function receiptTest(payload, outcome='success') {
  let output=''; const processMock={env:{RECEIPT_TEST_MODE:'1',EXPECTED_HEAD:head,ACTION_OUTCOME:outcome,STRUCTURED_OUTPUT:JSON.stringify(payload),DETAILS_URL:'https://example.test/run/1'},stdout:{write:value=>{output+=value;}}};
  vm.runInNewContext(receipt,{require:()=>fs,process:processMock,console});
  return {result:JSON.parse(output),code:processMock.exitCode};
}
assert.equal(receiptTest({verdict:'PASS',reviewed_head:head,summary:'ok',report:''}).result.state,'success');
assert.match(receiptTest({verdict:'BLOCK',reviewed_head:head,summary:'issue',report:''}).result.description,/empty/);
assert.equal(receiptTest({verdict:'PASS',reviewed_head:base,summary:'ok',report:''}).result.state,'failure');
assert.equal(receiptTest({verdict:'PASS',reviewed_head:head,summary:'ok',report:''},'failure').result.state,'failure');
async function companionTest(jobName,title,liveHead=head) {
  const posts=[];
  await vm.runInNewContext(blocks(companion)[0],{console,process:{env:{GITHUB_API_URL:'https://mock.test',GITHUB_REPOSITORY:'owner/repo',DISPLAY_TITLE:title,DETAILS_URL:'https://mock.test/run/1',FAILED_RUN_ID:'1',FAILED_EVENT:'pull_request',FAILED_CONCLUSION:'failure',RUN_ACTOR:'nikejshah'}},fetch:async(url,options)=>{
    if(options.method==='POST'){posts.push({url,body:JSON.parse(options.body)});return {ok:true};}
    const data=url.includes('/jobs?')?{jobs:jobName?[{name:jobName}]:[]}:url.includes('/workflows/')?{workflow_runs:[]}:url.includes('/commits/')?{statuses:[]}: {head:{sha:liveHead}};
    return {ok:true,json:async()=>data,headers:{get:()=>''}};
  }});
  return posts;
}
(async()=>{
  assert.equal((await companionTest(`claude-review-pr-4-head-${head}`,'Claude review PR #4 @ resolve-head')).filter(p=>p.url.includes('/statuses/')).length,1);
  assert.equal((await companionTest(null,'Claude review PR #4 @ resolve-head')).filter(p=>p.url.includes('/statuses/')).length,0);
  assert.equal((await companionTest(`claude-review-pr-4-head-${head}`,'Claude review PR #4 @ resolve-head',base)).filter(p=>p.url.includes('/statuses/')).length,0);
  console.log('Actual workflow inline packet, receipt and companion regression probes passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
