import React,{useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {z} from 'zod/v4';
import {AssignedLibraryReadSchema} from '@workspace/api-zod';
import {useColors} from '@/hooks/useColors';
import TogglePillButton from './TrainingAction';
import TrainingBody from './TrainingBody';
import TrainingChoice from './TrainingChoice';

type Data=z.infer<typeof AssignedLibraryReadSchema>;
type Props={onSectionChange?:()=>void;data:Data;busy:boolean;uncertain:boolean;send:(payload:unknown)=>Promise<unknown>;retry:()=>Promise<unknown>};
export default function GuidedTraining({data,busy,uncertain,send,retry,onSectionChange}:Props){
 const {t}=useTranslation(),colors=useColors();
 const training=data.metadata.content!.training!,guided=training.guided!,progress=data.assignment.progress.guided;
 const index=progress?.step??0,step=guided.steps[index],lesson=training.lessons.find(l=>l.id===step?.lessonId),responses=progress?.responses??{};
 const complete=data.assignment.status==='completed',locked=busy||uncertain||(!data.canSubmit&&!(complete&&data.certificationExam));
 const question=training.questions.find(q=>q.id===step?.questionIds.find(id=>!responses[id]||(!responses[id].correct&&!responses[id].remediatedAt)));
 const [selected,setSelected]=useState<string[]>([]),[notice,setNotice]=useState(''),[open,setOpen]=useState<string[]>([]);
 useEffect(()=>{setSelected([]);setNotice('');},[data.instanceId,index,question?.id]);
 useEffect(()=>setOpen([]),[data.instanceId]);
 useEffect(()=>{onSectionChange?.();},[data.instanceId,index,data.certificationExam?.attempt?.id,onSectionChange]);
 const act=async(payload:unknown)=>{try{setNotice('');await send(payload);}catch(e){setNotice(e instanceof Error?e.message:t('workHubLibrary.unconfirmed'));}};
 const label={color:colors.text,fontSize:16,lineHeight:24};
 const card={backgroundColor:colors.card,borderColor:colors.primary,borderWidth:1,borderRadius:14,padding:16,gap:12};
 const toggle=(id:string)=>setOpen(old=>old.includes(id)?old.filter(v=>v!==id):[...old,id]);
 const exam=data.certificationExam,attempt=exam?.attempt;
 const choose=(id:string,old:string[],multiple:boolean)=>multiple?(old.includes(id)?old.filter(v=>v!==id):[...old,id]):[id];
 return <View style={{gap:16,minWidth:0}}>
  <Text accessibilityRole="header" style={{...label,fontSize:20,fontWeight:'700'}}>{data.title}</Text>
  <Text style={label}>{t(complete?'h03Course.completed':'h03Course.section',{current:Math.min(index+1,guided.steps.length),total:guided.steps.length})}</Text>
  {progress?.scores&&<View style={card}><Text style={label}>{t('h03Course.originalScore')}: {progress.scores.originalCorrect}/{progress.scores.total}</Text><Text style={label}>{t('h03Course.remediatedScore')}: {progress.scores.remediatedCorrect}/{progress.scores.total}</Text></View>}
  {!complete&&lesson&&<View style={card}>
   <Text accessibilityRole="header" style={{...label,fontWeight:'700'}}>{lesson.title}</Text>
   <TrainingBody text={lesson.body} color={colors.text}/>
   {question?<View style={{gap:12}}><Text style={{...label,fontWeight:'700'}}>{question.prompt}</Text>
    {question.options.map(o=><TrainingChoice key={o.id} label={o.label} multiple={question.multiple} selected={(responses[question.id]?.originalOptionIds??selected).includes(o.id)} disabled={locked||!!responses[question.id]} onPress={()=>setSelected(choose(o.id,selected,question.multiple))}/>)}
    <TogglePillButton color="brand" disabled={locked||!selected.length||!!responses[question.id]} onPress={()=>void act({action:'answer',questionId:question.id,optionIds:selected})}>{t('h03Course.submitAnswer')}</TogglePillButton>
   </View>:<TogglePillButton color="brand" disabled={locked} onPress={()=>void act({action:'advance',acknowledged:true})}>{t(index===guided.steps.length-1?'h03Course.finish':'h03Course.continue')}</TogglePillButton>}
  </View>}
  {data.guidedFeedback&&<View style={card}>
   <Text accessibilityRole="header" style={{...label,fontWeight:'700'}}>{t('h03Course.reviewCorrection')}</Text>
   <Text style={label}>{t('h03Course.originalPreserved')}</Text>
   <Text style={label}>{t('h03Course.correctAnswer')}: {training.questions.find(q=>q.id===data.guidedFeedback!.questionId)?.options.filter(o=>data.guidedFeedback!.correctOptionIds.includes(o.id)).map(o=>o.label).join(', ')}</Text>
   <TrainingBody text={data.guidedFeedback.explanation} color={colors.text}/>
   <TogglePillButton color="brand" disabled={locked} onPress={()=>void act({action:'remediate',questionId:data.guidedFeedback!.questionId,acknowledged:true})}>{t('h03Course.acknowledge')}</TogglePillButton>
  </View>}
  {exam&&<View style={card}>
   <Text accessibilityRole="header" style={{...label,fontWeight:'700'}}>{t('certificationLearning.exam')}</Text>
   <Text style={label}>{t('certificationLearning.policy',{count:exam.questionCount,score:exam.passingPercent})}</Text>
   {!complete?<Text style={label}>{t('certificationLearning.finishLearning')}</Text>:!attempt||attempt.submittedAt?<>
    {attempt&&<Text accessibilityRole="text" style={label}>{t(attempt.passed?'certificationLearning.passed':'certificationLearning.notPassed',{score:attempt.score?.toFixed(1)})}</Text>}
    {!attempt?.passed&&(data.assignment.progress.certificationExam?.attempts.length??0)<exam.maximumAttempts&&<TogglePillButton color="brand" disabled={locked} onPress={()=>void act({action:'exam_start'})}>{t(attempt?'certificationLearning.retake':'certificationLearning.start')}</TogglePillButton>}
    {attempt?.submittedAt&&<><TogglePillButton color="brand" accessibilityState={{expanded:open.includes('exam-review')}} onPress={()=>toggle('exam-review')}>{t('certificationLearning.review')}</TogglePillButton>
     {open.includes('exam-review')&&exam.questions.map(q=><View key={q.id} style={{gap:8}}><Text style={label}>{q.prompt}</Text><Text style={label}>{t('h03Course.originalAnswer')}: {q.options.filter(o=>attempt.answers[q.id]?.includes(o.id)).map(o=>o.label).join(', ')}</Text><Text style={label}>{t('h03Course.correctAnswer')}: {q.options.filter(o=>exam.review.find(r=>r.questionId===q.id)?.correctOptionIds.includes(o.id)).map(o=>o.label).join(', ')}</Text><TrainingBody text={exam.review.find(r=>r.questionId===q.id)?.explanation??''} color={colors.text}/></View>)}
    </>}
   </>:<>
    <Text style={label}>{t('certificationLearning.savedAnswers',{answered:Object.keys(attempt.answers).length,total:exam.questions.length})}</Text>
    {exam.questions.map((q,i)=><View key={q.id} style={{gap:12}}><Text style={{...label,fontWeight:'700'}}>{i+1}. {q.prompt}</Text>{q.options.map(o=><TrainingChoice key={o.id} label={o.label} multiple={q.multiple} selected={attempt.answers[q.id]?.includes(o.id)??false} disabled={locked} onPress={()=>{const ids=choose(o.id,attempt.answers[q.id]??[],q.multiple);if(ids.length)void act({action:'exam_answer',attemptId:attempt.id,questionId:q.id,optionIds:ids});}}/>)}</View>)}
    <TogglePillButton color="brand" disabled={locked||exam.questions.some(q=>!attempt.answers[q.id]?.length)} onPress={()=>void act({action:'exam_submit',attemptId:attempt.id})}>{t('certificationLearning.submit')}</TogglePillButton>
   </>}
   {!!data.assignment.progress.certificationExam?.attempts.length&&<><TogglePillButton color="brand" accessibilityState={{expanded:open.includes('exam-history')}} onPress={()=>toggle('exam-history')}>{t('certificationLearning.history')}</TogglePillButton>{open.includes('exam-history')&&data.assignment.progress.certificationExam.attempts.map((a,i)=><Text key={a.id} style={label}>{i+1}. {a.submittedAt?t(a.passed?'certificationLearning.passed':'certificationLearning.notPassed',{score:a.score?.toFixed(1)}):t('certificationLearning.inProgress')}</Text>)}</>}
  </View>}
  {training.lessons.filter(l=>complete||!guided.steps.some(s=>s.lessonId===l.id)).map(l=><View key={l.id} style={card}><Text accessibilityRole="header" style={{...label,fontWeight:'700'}}>{l.title}</Text><TogglePillButton color="brand" height={44} accessibilityLabel={`${t(open.includes(l.id)?'certificationLearning.closeLesson':'certificationLearning.openLesson')}: ${l.title}`} accessibilityState={{expanded:open.includes(l.id)}} onPress={()=>toggle(l.id)}>{t(open.includes(l.id)?'certificationLearning.closeLesson':'certificationLearning.openLesson')}</TogglePillButton>{open.includes(l.id)&&<TrainingBody text={l.body} color={colors.text}/>}</View>)}
  {!!notice&&<Text accessibilityRole="alert" style={label}>{notice}</Text>}
  {uncertain&&<TogglePillButton color="brand" disabled={busy} onPress={()=>void retry().catch(e=>setNotice(e instanceof Error?e.message:t('workHubLibrary.unconfirmed')))}>{t('workHubLibrary.retry')}</TogglePillButton>}
 </View>;
}
