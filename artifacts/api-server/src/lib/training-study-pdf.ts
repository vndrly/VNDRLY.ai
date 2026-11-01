import PDFDocument from 'pdfkit';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {LibraryDraft} from '@workspace/api-zod';
import {buildTrainingCourseGuide,plainCourseText} from './training-course-guide';
type Guide=ReturnType<typeof buildTrainingCourseGuide>;
export async function renderTrainingStudyPdf(content:LibraryDraft,guide:Guide,version:number):Promise<Buffer>{
 const doc=new PDFDocument({size:'LETTER',margin:48,bufferPages:true,info:{Title:`${content.title} — Study guide`,Author:'VNDRLY',Subject:guide.purpose}});
 const chunks:Buffer[]=[];doc.on('data',(chunk:Buffer)=>chunks.push(chunk));
 const complete=new Promise<Buffer>((resolve,reject)=>{doc.once('end',()=>resolve(Buffer.concat(chunks)));doc.once('error',reject);});
 const sourceFonts=new URL('../assets/study-fonts/',import.meta.url),fonts=existsSync(new URL('LiberationSans-Regular.ttf',sourceFonts))?sourceFonts:new URL('./assets/study-fonts/',import.meta.url);
 doc.registerFont('Study',fileURLToPath(new URL('LiberationSans-Regular.ttf',fonts)));doc.registerFont('StudyBold',fileURLToPath(new URL('LiberationSans-Bold.ttf',fonts)));
 const text=plainCourseText;
 const heading=(s:string,size=16)=>{if(doc.y>670)doc.addPage();doc.moveDown(0.6).font('StudyBold').fontSize(size).fillColor('#17354b').text(text(s));doc.moveDown(0.35);};
 const paragraph=(s:string)=>{doc.font('Study').fontSize(10.5).fillColor('#18232c').text(text(s),{lineGap:3,paragraphGap:7});doc.moveDown(0.3);};
 doc.font('StudyBold').fontSize(12).fillColor('#17354b').text('VNDRLY');doc.moveDown(1);
 doc.fontSize(25).text(text(content.title));doc.moveDown(0.5);doc.font('Study').fontSize(12).text(`Study guide | Course version ${version}`);
 heading('About this course');paragraph(guide.description);heading('Purpose');paragraph(guide.purpose);
 heading('Training outline');for(const section of guide.outline){paragraph(`${section.number}. ${section.title}${section.questionCount?` (${section.questionCount} ${section.questionCount===1?'question':'questions'})`:''}`);}
 heading('How course scoring works');
 paragraph(guide.scoring.guided?`The ${guide.scoring.questionCount} learning questions retain your first answers. Original score is first-answer correct responses divided by total questions, expressed as a percentage. An incorrect answer presents an explanation and the correct answer. Acknowledging the correction accomplishes that question and contributes to the remediated score. Complete all course sections and questions to complete the guided learning.`:`The course passing standard is ${guide.scoring.passingPercent}%.`);
 if(guide.scoring.exam)paragraph(`The separate certification exam contains ${guide.scoring.exam.questionCount} questions and has a ${guide.scoring.exam.passingPercent}% passing standard. Its result is recorded separately from the learning-check scores. Take the certification exam in VNDRLY.`);
 paragraph(guide.companyScoring.explanation);paragraph(`Training component: ${guide.companyScoring.formula}.`);
 for(const [index,lesson] of (content.training?.lessons??[]).entries()){
  doc.addPage();heading(`${index+1}. ${guide.outline.find(section=>section.lessonId===lesson.id)?.title??lesson.title}`,19);
  for(const block of lesson.body.split(/\n\s*\n/)){
   if(!block.trim())continue;
   if(/^#{1,6}\s/.test(block.trim()))heading(block.trim().replace(/^#{1,6}\s+/,''),13);
   else paragraph(block);
  }
 }
 if(content.training?.questions.length){
  doc.addPage();heading('Practice questions',20);
  for(const [index,q] of content.training.questions.entries()){
   heading(`${index+1}. ${q.prompt}`,12);
   for(const [i,option]of q.options.entries())paragraph(`${String.fromCharCode(65+i)}. ${option.label}`);
  }
  doc.addPage();heading('Practice answer explanations',20);
  for(const [index,q]of content.training.questions.entries()){
   const answers=q.options.flatMap((o,i)=>q.correctOptionIds.includes(o.id)?[`${String.fromCharCode(65+i)}. ${o.label}`]:[]);
   heading(`${index+1}. ${answers.join('; ')}`,12);paragraph(content.training.guided?.explanations[q.id]??'');
  }
 }
 const pages=doc.bufferedPageRange();for(let page=pages.start;page<pages.start+pages.count;page++){
  doc.switchToPage(page);doc.font('Study').fontSize(8).fillColor('#52616c');
  doc.text(`VNDRLY | ${page+1} / ${pages.count}`,48,doc.page.height-35,{lineBreak:false});
 }
 doc.end();return complete;
}
