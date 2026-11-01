import {it,expect} from 'vitest';
import {protectedOwnerTraining} from './library-policy';
it('removes the complete issuer bank for G99 owner reads without changing authored courses or input',()=>{
 const training={lessons:[{id:'lesson'}],certificationExam:{questions:[{id:'exam',correctOptionIds:['a'],explanation:'Private issuer rationale'}]}};
 expect(protectedOwnerTraining(training,'G99')).toEqual({lessons:training.lessons});
 expect(protectedOwnerTraining(training,'H03')).toBe(training);
 expect(protectedOwnerTraining(training)).toBe(training);
 expect(training.certificationExam.questions).toHaveLength(1);
});
