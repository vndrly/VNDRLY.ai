import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE_SHA,REPO,ALLOWED,cleanLog,parsePassed,parseListed,validateDiff,validateBaseline,remainingTests} from '../verify-browser-remainder.mjs';
const names=Array.from({length:43},(_,i)=>`[chromium] › tests/example-${i}.spec.ts:1:1 › test ${i}`);
const last='[chromium] › tests/work-hub-workspace.spec.ts:51:3 › Work Hub workspace persisted flow › group and chat persist';
const passedLog=names.map((n,i)=>`2026-10-18T03:43:50.6109463Z \u001b[32m  ✓ ${i+1} ${n} (${i===0?'1.2m':'3.4s'})\u001b[0m`).join('\n');
const log='> workspace@0.0.0 test:e2e /home/runner\nRunning 44 tests using 1 worker\n'+passedLog;
const run={status:'completed',head_sha:BASELINE_SHA,repository:{full_name:REPO},head_repository:{full_name:REPO},head_branch:'codex/workhub-teams',path:'.github/workflows/verify-release.yml',conclusion:'cancelled'};
const steps=['Typecheck and locale parity','Independent database-backed API gate','Rehearse first application and replay of guarded Work Hub migrations','Verify fresh test database safety invariants'].map(name=>({name,status:'completed',conclusion:'success'}));
const jobs=[{id:1,name:'verify',status:'completed',conclusion:'cancelled',steps:[...steps,{name:'Full required test chain',conclusion:'cancelled'}]}];
test('parser accepts timestamps ANSI and duration suffixes',()=>{assert.deepEqual(parsePassed(passedLog),names);assert.deepEqual(parseListed(names.join('\n')),names);assert(!cleanLog(passedLog).includes('\u001b'));});
test('coverage requires exactly one known missing identity',()=>{assert.deepEqual(remainingTests(names,[...names,last]),[last]);assert.throws(()=>remainingTests(names.slice(1),[...names,last]));assert.throws(()=>remainingTests(names,[...names,last.replace('work-hub-workspace','other')]));});
test('application edits and verification weakening fail closed',()=>{validateDiff(ALLOWED,'timeout-minutes: 35\r\n','timeout-minutes: 45\n');assert.throws(()=>validateDiff(['artifacts/api-server/src/app.ts'],'timeout-minutes: 35','timeout-minutes: 45'));assert.throws(()=>validateDiff(ALLOWED,'timeout-minutes: 35\nmandatory:true','timeout-minutes: 45\nmandatory:false'));});
test('requires baseline provenance, all independent gates and 43 browser passes',()=>{assert.equal(validateBaseline(run,jobs,log,'codex/workhub-teams').passed.length,43);assert.throws(()=>validateBaseline({...run,head_sha:'bad'},jobs,log,'codex/workhub-teams'));assert.throws(()=>validateBaseline(run,[{...jobs[0],steps:[]}],log,'codex/workhub-teams'));assert.throws(()=>validateBaseline(run,jobs,log+'\n ✘ 44 [chromium] › broken (2s)','codex/workhub-teams'));assert.throws(()=>validateBaseline({...run,conclusion:'failure'},jobs,log,'codex/workhub-teams'));});

test("list reporter paths normalize to line reporter paths",()=>{assert.deepEqual(parseListed(names.map(n=>n.replace("tests/","")).join("\n")),names);});
