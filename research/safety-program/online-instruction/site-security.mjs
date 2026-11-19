// Original instructional content. Development source; importing this file does
// not publish a course, assign training, or change completion requirements.
const check=(id,prompt,options,answer,feedback)=>({id,prompt,options,answer,feedback});
export const siteSecurity={
 id:'site-security',title:'Site Security',status:'development',
 audience:'Gatekeepers, site support personnel, supervisors and security coordinators at industrial energy sites.',
 purpose:'Make sound access, observation, reporting and incident-coordination decisions within the worker’s assigned role.',
 credentialScope:'VNDRLY/U instruction in site-security duties. This is not a state security license, law-enforcement qualification, hazardous-materials response qualification or FAA pilot certificate.',
 delivery:'Self-paced online instruction. Estimated section times include explanation, examples and retention checks; they are not mandatory timers.',
 completionPolicy:{status:'approved',passingPercent:80,selfPacedRetries:true,droneSection:'included for everyone',faaLicenseRequiredForLearningOrAward:false,employerSignoffRequired:false,additionalPrerequisites:[]},
 reuse:[
  {courseId:'VUC001-C04',purpose:'Reliable communication and factual reporting',copy:false},
  {courseId:'VUC001-C08',purpose:'Chemical information and atmosphere-alarm boundaries',copy:false},
  {courseId:'VUC001-C12',purpose:'Emergency action and spill awareness',copy:false},
  {courseId:'VUC113-C01',purpose:'Reuse relevant mission-planning, weather, observation and imagery concepts for security use; no FAA-license prerequisite',copy:false},
 ],
 sources:[
  {url:'https://www.cisa.gov/sites/default/files/2025-01/De-escalation-Action-Guide_v508_20250127.pdf',use:'De-escalation and disengagement boundaries'},
  {url:'https://www.osha.gov/emergency-preparedness/hazardous-waste-operations/preparedness',use:'Distinguishing awareness and notification from emergency response'},
  {url:'https://www.faa.gov/uas/commercial_operators',use:'Remote pilot certification and operational scope'},
  {url:'https://www.faa.gov/uas/contact_us/report_uas_sighting',use:'Reporting concerning drone activity'},
 ],
 sections:[
  {id:'gatekeeper',title:'Gatekeeper',sessions:[
   {id:'gate-identity',title:'A person, a purpose and a permission',minutes:7,
    objective:'Distinguish identity from permission and resolve an uncertain arrival without guessing.',
    instruction:`At a gate, three different questions must be answered: Who is this person? What are they here to do? What authorizes that visit now? A recognizable face answers only part of the first question. A company shirt or vehicle logo does not answer the other two. Use the site’s approved identity and visitor process, then check the destination, host and visit scope against the current record.

Keep the conversation neutral. “I need to confirm your host and destination” describes your task without accusing anyone. Use a known company contact or the approved directory to confirm an unexpected visit. A telephone number supplied by the visitor may be useful information, but is not independent confirmation. Record the actual result: confirmed, awaiting confirmation, declined by the responsible person, or another status supported by the site process. Do not record an unverified visitor as approved merely to clear the queue.

Permission has boundaries. Approval to deliver at a receiving point is not permission to enter a process area. An escort requirement is not fulfilled by telling a visitor to find someone inside. Explain the authorized waiting location, route and next step. If your system is unavailable, use the established outage procedure rather than silently treating a failed lookup as approval.`,
    example:`Fictional site rule: deliveries wait in Bay A until the receiving coordinator confirms them. A driver presents an accurate order number but the delivery is absent from today’s schedule. The order supports the purpose of the visit; it does not resolve today’s access. Tell the driver where to wait, contact receiving through the approved directory, and record the decision. If receiving confirms Bay A only, do not expand that to the whole site.`,
    checks:[check('gate-identity-1','A valid ID and yesterday’s approval are presented. What still needs checking?',['Today’s permission and permitted destination','Nothing; the ID is sufficient','Whether the visitor seems confident'],0,'Identity, purpose and current permission are separate facts. Verify the scope of today’s visit.'),check('gate-identity-2','The visitor offers a phone number for an unfamiliar approver. What provides independent confirmation?',['Call only that number','Use the approved company directory or established contact','Ask the next driver'],1,'Use a trusted contact path. A visitor-supplied contact cannot independently validate their own request.')]
   },
   {id:'gate-movement',title:'People and vehicles through the gate',minutes:6,
    objective:'Maintain the approved access sequence without creating a traffic exposure.',
    instruction:`An access decision and a vehicle movement are different events. First confirm the permitted movement; then communicate when and where it can occur. Give short directions using the site’s named waiting points, lanes and pedestrian routes. Obtain acknowledgment when an instruction is unclear. Never stand in a vehicle’s path to make a driver comply.

Watch for a second vehicle following the first through an opening. Do not assume that the first driver’s approval covers another vehicle or every passenger. Use the site’s barrier and traffic process to resolve the second arrival. Do not improvise a sudden barrier closure onto an occupied lane. If the system or driver behavior creates a dangerous situation, withdraw to safety and contact the responsible traffic or security personnel.

For departures, use the applicable site process for people, vehicles and property. A property-release check is not a substitute for keeping an emergency exit usable. Know the emergency arrangement before a queue forms. Your task is to apply the approved process and communicate an exception, not physically restrain a person or chase a vehicle.`,
    example:`A second truck follows an approved truck toward the entrance. From the protected gate position, use the established stop/wait signal and contact site support if it does not stop. Record the observed vehicle and direction of travel. Do not run alongside it or step in front of it.`,
    checks:[check('gate-movement-1','An approved truck is followed closely by an unverified truck. Which assumption is unsafe?',['Each arrival needs its own access decision','The first approval also covers the following truck','The gatekeeper should remain clear of moving vehicles'],1,'One access decision does not automatically cover a second arrival.')]
   },
   {id:'gate-conflict',title:'An upset visitor or unauthorized access',minutes:8,
    objective:'Communicate a boundary clearly and recognize when to disengage.',
    instruction:`A delay can frustrate someone without making them a threat. Focus on observable behavior and the access issue. Speak calmly, allow space, and offer a concrete next step within your authority: “Receiving has not confirmed this delivery. I can call them again while you wait in Bay A.” Avoid arguing about motives or making promises that you cannot keep.

Keep a safe exit available. Do not touch the person, surround them, insult them or try to win an argument. If behavior becomes threatening, disengage and use the site’s emergency or security contact process. Your personal safety takes priority over finishing an entry on the screen. A security course does not grant powers of arrest or authorize a physical search.

If someone enters without authorization, report what happened, where the person or vehicle was last seen, and any immediate exposure. Distinguish what you observed from what you inferred. “The vehicle passed the stop point and continued toward Receiving” is a useful observation. “The driver is a thief” is an allegation that the observation alone does not establish. Follow the site’s incident procedure; do not pursue the person into an unsafe area.`,
    example:`A visitor says a manager will have you fired unless you open the gate. The next action is still verification through the established channel. You can acknowledge the urgency without changing the access decision. If the visitor threatens violence, move to a safe position and obtain emergency assistance rather than continuing the disagreement.`,
    checks:[check('gate-conflict-1','Which report separates observation from accusation?',['A criminal forced entry','A vehicle passed the stop point without confirmation and continued east','The driver looked suspicious'],1,'Describe the action, location and direction. Do not invent a motive.'),check('gate-conflict-2','A person threatens violence during an access dispute. What is the priority?',['Finish all visitor fields','Disengage safely and obtain appropriate assistance','Prove that the visitor is wrong'],1,'A threatened confrontation is not a paperwork problem. Preserve safety and follow the emergency process.')]
   },
  ]},
  {id:'observation',title:'Observation and incident records',sessions:[
   {id:'security-theft',title:'Suspected theft and unusual activity',minutes:7,
    objective:'Report a possible loss or security event without confrontation or unsupported conclusions.',
    instruction:`The useful starting point for a suspected theft is a discrepancy: an item is absent, a seal differs from its recorded state, or a movement lacks the expected release record. Check what your role permits you to verify from a safe location. An inaccurate inventory entry is possible; so is an unauthorized removal. Preserve those possibilities until evidence resolves them.

Record the time, place, item or asset identifier, observed action and relevant record reference. If the site permits photographs, take only what can be captured safely and store it through the approved channel. Do not post images or allegations to a personal group chat. Keep original records intact. If you later discover an error, add a correction with its time and reason rather than rewriting the event as though the first entry never existed.

Notify the designated supervisor or security contact. If there is immediate danger, use the emergency process. Do not confront a suspected person, search their property, seize a device or chase a departing vehicle on the strength of this training. A factual report allows the authorized people to decide what investigation or response is appropriate.`,
    example:`A pump listed in Storage B is missing and a truck left earlier. The record supports “pump not located during this check” and “truck departure recorded at 14:10.” It does not yet prove that the truck carried the pump. Link the relevant records and report the discrepancy without merging them into an unsupported accusation.`,
    checks:[check('security-theft-1','What should happen when an initial report contains a mistaken asset number?',['Silently replace the original entry','Add a dated correction that preserves the original record','Delete the entire incident'],1,'A traceable correction preserves the sequence and lets a reviewer distinguish the original observation from later clarification.')]
   },
   {id:'security-handover',title:'A handover the next shift can use',minutes:5,
    objective:'Leave unresolved events with a clear owner, current status and next action.',
    instruction:`A handover should let the next person act without reconstructing the whole shift. For each unresolved item, record the location or reference, what is known, what remains uncertain, the current control, who was contacted and the next expected action. Include the time of the most recent update. An old statement can be accurate about the past and unsafe if mistaken for the current condition.

Separate a request from a confirmed action. “Supervisor called” does not mean “supervisor approved.” “Camera review requested” does not mean “the recording proves theft.” If an event has been closed, identify who closed it and the recorded basis. Do not close it simply because your shift ended.

Use a short read-back for important unresolved issues. The receiving person repeats the next action and you resolve any disagreement before the handover ends. Protect personal information: include what the next worker needs for the task, not unrelated medical details, speculation or personal commentary.`,
    example:`Weak: “Delivery problem sorted.” Usable: “Delivery D-41 remains in Bay A as of 17:55. Receiving was contacted at 17:50; no confirmation received. Next shift to call the receiving coordinator through the directory before authorizing entry.”`,
    checks:[check('security-handover-1','Which statement is a confirmed access decision?',['Message left for supervisor','Visitor says the manager knows','Receiving confirmed entry to Bay A at 17:58; confirmation recorded'],2,'State who confirmed what, when, and where the supporting record can be found.')]
   },
  ]},
  {id:'incident-support',title:'Spills and emergency coordination',sessions:[
   {id:'security-spill',title:'A suspected hazardous spill at the entrance',minutes:8,
    objective:'Recognize the event, protect yourself and communicate useful facts without attempting unassigned response work.',
    instruction:`For this section, your role is discovery, safe withdrawal and notification. Seeing a leak does not tell you the substance, concentration, atmosphere or safe approach distance. Stay out of liquid, vapor and affected traffic areas. Use the site’s emergency instructions and move to a safe position. Do not approach a vehicle or container merely to read a label.

From safety, report the location, what you can actually see, any people affected, and access routes that appear obstructed. Give a placard or container identifier only if already known or visible without approaching. Say “unknown” when the substance is unknown. Follow the emergency coordinator’s instructions for stopping incoming traffic or directing responders; do not route them through the suspected release.

Spill kits are equipment, not permission. Do not place absorbent, operate valves, collect samples, enter a vapor area or undertake a rescue unless those actions belong to your actual trained and authorized response role. This gatekeeper lesson does not teach those specialist actions. Resume normal entry only when the responsible site authority communicates the applicable clearance. Record who provided it and any remaining restrictions.`,
    example:`A delivery truck stops outside the entrance and liquid spreads toward the arrival lane. You do not know the product. From a safe position, notify the site emergency contact, identify the gate and affected lane, and keep yourself clear. If the approved traffic arrangement lets you redirect arrivals from safety, follow it; do not stand beside the leak to wave vehicles around it.`,
    checks:[check('security-spill-1','The product is unknown and a spill kit is nearby. What does the kit establish?',['That cleanup is safe','That you are authorized to clean up','Only that equipment is available; it does not establish your response role'],2,'Equipment availability does not establish hazard conditions, training or authority.'),check('security-spill-2','Which information should you report?',['A guessed chemical name','Location, visible conditions, people affected and what remains unknown','Only a photograph taken beside the leak'],1,'Accurate observations from safety help responders. A guessed identity can misdirect the response.')]
   },
  ]},
  {id:'drone-security',title:'Drones in site security',sessions:[
   {id:'security-drone-task',title:'When a drone helps—and when it does not',minutes:7,
    objective:'Define a useful security observation task and distinguish it from permission to fly.',
    instruction:`A useful drone request begins with an observation question: “Can the authorized crew inspect the remote fence line for storm damage?” That is more actionable than “Fly around and look for anything suspicious.” Identify the area of interest, what evidence would answer the question, how urgent it is, and who receives the result. This section teaches how a Gatekeeper defines and supports a security observation task. Relevant planning concepts can be reused from the existing drone material without requiring completion of FAA-license preparation.

Site permission and aviation authorization answer different questions. A site manager may request an inspection, but that request alone does not establish the pilot’s qualifications, airspace authorization or a safe flight plan. The responsible pilot evaluates the operation. A gatekeeper should coordinate ground access and relevant site information without promising that a flight can proceed.

Consider whether a ground inspection or existing camera can answer the question with less exposure. A drone image is an observation with limitations: lighting, angle, obscured areas and time affect what it can establish. Report those limits. An apparently intact fence in one image does not establish the condition of a hidden section.`,
    example:`After a storm, the manager requests imagery of the north fence. The request identifies the fence segment, suspected damage, nearby operations and reporting contact. The pilot determines whether the mission can be conducted under the applicable conditions. If flight is unsuitable, the security need remains and the manager considers another safe inspection method.`,
    checks:[check('security-drone-task-1','A manager requests a security flight. Who determines whether the proposed flight can be conducted safely and lawfully?',['The responsible remote pilot, with required coordination','The person who wants the imagery soonest','Any employee who owns a drone'],0,'A security request defines the need; it does not replace the pilot’s operational responsibility.')]
   },
   {id:'security-drone-report',title:'Unknown drones and handling imagery',minutes:6,
    objective:'Record useful observations and protect security imagery without attempting unauthorized interference.',
    instruction:`An unfamiliar drone is not automatically hostile. Record the time, observed location and direction, apparent activity, and any immediate effect on people or operations. Distinguish observation from estimates: distance and altitude judged from the ground can be uncertain. Notify the designated site security contact and follow the applicable reporting process. For immediate danger, use emergency assistance.

Do not attempt to jam, seize, damage or take control of an aircraft. This course provides no authority or technical training for counter-drone intervention. Keep people clear of a fallen aircraft and report its location; do not handle batteries or other unfamiliar components without the relevant response procedure.

For imagery collected by the authorized site team, preserve the original file and its associated time and mission reference. Store it in the approved location with access appropriate to the security purpose. A cropped image can be useful for a report, but should be labeled as an extract and linked to the original. Avoid distributing imagery of people, security arrangements or neighboring property beyond the authorized purpose.`,
    example:`You observe a drone near the west perimeter at 09:20 but cannot identify its operator. Record the observation and notify the site contact. Do not describe it as an attack without supporting facts. If a screenshot is saved under the site process, retain its timestamp and note that it shows only that moment and viewpoint.`,
    checks:[check('security-drone-report-1','What is an appropriate first record of an unidentified drone?',['An assertion that an attack is underway','Time, location, observed activity and uncertainty','Instructions to disable it'],1,'Useful reporting describes what was observed and leaves unsupported conclusions out.')]
   },
  ]},
 ],
 optionalEmployerExercises:[
  {id:'gate-record',title:'Record a simulated visitor arrival',task:'Using a fictional visitor and an employer-approved practice environment, record identity-check outcome, host confirmation, permitted destination and departure. Do not create a real access authorization.',evidence:['Fictional record reference','Explanation of what was confirmed and what remained uncertain'],observerPrompts:['Did the learner separate identity from permission?','Was the entry factual and appropriately limited?'],requiredForCompletion:false},
  {id:'handover-record',title:'Prepare a shift handover',task:'Prepare a handover from the fictional D-41 delivery example. A supervisor may review it and record feedback.',evidence:['Written handover','Reviewer feedback if provided'],observerPrompts:['Are current status, contact and next action clear?'],requiredForCompletion:false},
 ],
};
