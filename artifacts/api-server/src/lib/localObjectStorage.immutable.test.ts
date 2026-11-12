import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {localWriteUpload,localSetAclPolicy,localGetObjectAcl} from './localObjectStorage';
let dir:string|undefined;
afterEach(async()=>{vi.unstubAllEnvs();if(dir)await fs.rm(dir,{recursive:true,force:true});});
describe('immutable upload evidence',()=>{it('permits identical retries without replacing ACL and rejects changed bytes',async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'gate-evidence-test-'));vi.stubEnv('LOCAL_OBJECT_DIR',dir);
 await localWriteUpload('evidence','image/jpeg',Buffer.from('original'));
 const acl={owner:'operator',visibility:'private' as const,purpose:'gate-evidence' as const};
 await localSetAclPolicy('/objects/uploads/evidence',acl);
 await localWriteUpload('evidence','image/jpeg',Buffer.from('original'));
 expect(await localGetObjectAcl('/objects/uploads/evidence')).toEqual(acl);
 await expect(localWriteUpload('evidence','image/jpeg',Buffer.from('replacement'))).rejects.toThrow('already exists');
 await expect(localWriteUpload('evidence','image/png',Buffer.from('original'))).rejects.toThrow('already exists');
 expect(await fs.readFile(path.join(dir,'uploads','evidence'),'utf8')).toBe('original');
});});
