// Server-side authoring source. Never include this bank in a learner response
// before an attempt has been submitted. No award policy is activated here.
const item=(id,domain,prompt,options,correct,explanation)=>({id,domain,prompt,options,correct,explanation});
export const siteSecurityAssessment={
 programId:'site-security',status:'development',
 scoring:{method:'One point per correct decision',passingPercent:80,retries:'self-paced',maximumAttempts:null,approvedBy:'John',approvedOn:'2026-11-19',employerSignoffRequired:false,faaLicenseRequired:false},
 // Separate situations from the lesson checks; all settings are fictional.
 questions:[
  item('SS-F01','gatekeeper','At North Gate, a familiar contractor arrives for a different job from yesterday. The current visitor record has no host confirmation. What should you do?',[
   'Authorize access because the contractor is familiar',
   'Keep the contractor in the approved waiting arrangement and confirm today’s host and scope',
   'Copy yesterday’s approval into today’s record',
  ],1,'Familiarity does not establish a current work purpose or access scope. Confirm through the site process and record the actual outcome.'),
  item('SS-F02','gatekeeper','Receiving confirms that a courier may enter the receiving yard with an escort. The courier asks to go directly to the pump building instead. What does the confirmation allow?',[
   'Any destination named by the courier',
   'Unescorted access because a host confirmed the visit',
   'The stated receiving-yard visit with the escort arrangement; a different destination needs resolution',
  ],2,'Approval is bounded by destination and conditions. Do not silently expand it.'),
  item('SS-F03','gatekeeper','The access system stops responding during a delivery rush. What is the sound next step?',[
   'Use the established outage process and record what is verified and unresolved',
   'Treat a failed lookup as approval',
   'Allow every scheduled supplier to approve its own entry',
  ],0,'A system outage does not create authorization. Apply the actual contingency process rather than improvising approval.'),
  item('SS-F04','gatekeeper','An unverified vehicle follows an approved arrival toward an opening. Which response avoids creating an additional exposure?',[
   'Step into its path and demand identification',
   'Use the established traffic-control process from a safe position and obtain support if needed',
   'Run after it into the operating area',
  ],1,'Keep yourself clear of vehicle movement. Communicate and escalate through the approved process instead of using your body as a barrier.'),
  item('SS-F05','gatekeeper','A visitor is upset about a delay but has not threatened anyone. Which statement is most useful?',[
   'You are acting guilty',
   'I will approve it myself if you calm down',
   'I understand the delay is frustrating; I can contact receiving while you wait in the designated area',
  ],2,'Acknowledge the issue and offer a concrete action within your authority without an accusation or unsupported promise.'),
  item('SS-F06','gatekeeper','The same visitor now threatens violence and moves closer. What changes your priority?',[
   'Personal safety: disengage and obtain the appropriate assistance',
   'The need to finish the visitor form before leaving',
   'The need to prove the visitor’s story is false',
  ],0,'A threatened confrontation calls for safe disengagement and assistance. The record can be completed after immediate safety is addressed.'),
  item('SS-F07','observation','A tool is missing from its recorded location, but no one has checked the transfer log. Which entry is supported?',[
   'The afternoon driver stole the tool',
   'Tool T-8 was not found at the recorded location at 16:15; transfer history has not yet been checked',
   'The tool was definitely stolen before 16:15',
  ],1,'Record the discrepancy and remaining uncertainty. Missing from one location does not establish who moved it or why.'),
  item('SS-F08','observation','You discover a timestamp error in your incident note. What preserves a reliable record?',[
   'Replace the original time without comment',
   'Delete the note and start over',
   'Add a dated correction explaining the time error while retaining the original entry',
  ],2,'A traceable correction distinguishes initial observation from later clarification.'),
  item('SS-F09','observation','A coworker asks you to post a suspected-theft image to a personal group chat so everyone knows whom to watch. What should you do?',[
   'Use the approved reporting and storage channel rather than distributing an allegation and image informally',
   'Post it with the person’s name and a theft accusation',
   'Crop out the timestamp and post it anonymously',
  ],0,'Use an authorized purpose and channel. Informal distribution can expose personal information and detach an image from its context.'),
  item('SS-F10','observation','The outgoing shift says, “Supervisor notified, so the delivery is approved.” The log only shows a message left. What should the incoming shift record?',[
   'Approved because a message was sent',
   'Awaiting confirmation, with the current waiting arrangement and next contact action',
   'Closed because the outgoing shift ended',
  ],1,'A notification is not a confirmed decision. Handover must preserve the actual current state.'),
  item('SS-F11','incident-support','An unknown liquid appears beneath a truck outside the gate. What information should you give from safety?',[
   'A chemical name guessed from the truck’s usual deliveries',
   'Only the statement that something is wrong',
   'The location, observed conditions, affected people or routes, and the fact that the substance is unknown',
  ],2,'Useful emergency information is specific and honest about uncertainty. Do not approach to improve the report.'),
  item('SS-F12','incident-support','A visitor asks you to put absorbent around the leak because there is a spill kit nearby. Your role is discovery and notification. What is the correct decision?',[
   'Stay within that role and obtain the designated response; kit availability does not establish authorization',
   'Use the kit if the liquid has no strong odor',
   'Start cleanup before the response team arrives to save time',
  ],0,'Unknown hazards and response-role limits are not resolved by equipment availability or lack of odor.'),
  item('SS-F13','incident-support','After responders arrive, a waiting driver says the lane must now be safe. What establishes the gate’s next access action?',[
   'The driver’s confidence',
   'The responsible site authority’s clearance and any remaining restrictions',
   'The fact that a responder vehicle is parked nearby',
  ],1,'Responder presence alone does not communicate the clearance or remaining traffic restrictions.'),
  item('SS-F14','drone-security','Which request gives a drone team the clearest site-security observation task?',[
   'Fly everywhere and find anything strange',
   'Get dramatic footage for the incident chat',
   'Check the specified north fence segment for storm damage and report the visible condition and any areas not observed',
  ],2,'Specify the question, location and expected evidence. A bounded task supports useful planning and an honest result.'),
  item('SS-F15','drone-security','The manager requests immediate drone imagery but the pilot identifies conditions that make the proposed flight unsuitable. What should the security coordinator do?',[
   'Consider another safe observation method with the responsible team',
   'Override the pilot because the manager owns the site',
   'Ask an unqualified coworker to fly instead',
  ],0,'The observation need remains, but urgency does not make an unsuitable flight appropriate.'),
  item('SS-F16','drone-security','Aerial imagery shows most of a fence intact, but vegetation hides one segment. Which report is accurate?',[
   'The whole perimeter is secure',
   'The visible segment appears intact at the recorded time; the obscured segment was not verified',
   'The hidden segment can be assumed intact because adjacent sections are intact',
  ],1,'State the limits of coverage. An image cannot establish the condition of an area it does not show.'),
  item('SS-F17','drone-security','An unfamiliar drone is observed near the site. There is no identified operator or confirmed hostile act. What is appropriate?',[
   'Attempt to interfere with its control signal',
   'State that an attack is confirmed',
   'Record the observed activity and uncertainty and notify the designated site contact',
  ],2,'Report observable facts and use the designated response path. This training grants no counter-drone intervention authority.'),
  item('SS-F18','drone-security','An image is cropped for an incident report. What should be preserved?',[
   'The original file, time and mission reference, with the cropped version identified as an extract',
   'Only the crop, because it contains the interesting part',
   'A new timestamp that makes the image easier to file',
  ],0,'Preserving the original and context supports later review of what the image does and does not show.'),
  item('SS-F19','integration','A spill closes the usual entrance while an unverified visitor insists on entering through a service gate. What is the best combined decision?',[
   'Let the visitor choose any unblocked route',
   'Follow emergency access instructions and separately resolve the visitor’s permission through the responsible contact',
   'Assume the emergency suspends all access verification',
  ],1,'Route safety and visitor authorization remain distinct decisions. Coordinate both through the applicable site process.'),
  item('SS-F20','integration','A supervisor reviews a fictional handover exercise and gives positive feedback. What does the exercise record establish?',[
   'An FAA pilot license',
   'Authority to conduct hazardous-material cleanup',
   'Practice and feedback on the stated communication task',
  ],2,'Record the evidence within its actual scope. A communication exercise does not confer unrelated operational or external credentials.'),
 ],
};
