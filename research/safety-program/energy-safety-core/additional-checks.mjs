const q=(id,prompt,labels,correct,explanation)=>({id,prompt,options:labels.map((label,i)=>({id:String.fromCharCode(97+i),label})),multiple:false,correctOptionIds:[String.fromCharCode(97+correct)],explanation});
export const additionalChecks={
 ESC01:[q('ESC01-K5','How should a crew use life-saving rules when a required safeguard cannot be verified?',['Recite the names and continue.','Pause the affected exposure and resolve the actual safeguard through the work process.','Assume the rule is a replacement for the operating procedure.','Treat a previous course score as field verification.'],1,'The principles direct attention to fatal-risk defenses. Verify the actual safeguard rather than treating recall or paperwork as proof of protection.')],
 ESC02:[q('ESC02-K5','Which decision best reflects industrial hygiene?',['Wait for visible illness before considering exposure.','Select PPE from its color alone.','Evaluate the actual task and exposure using appropriate methods, control the source and verify effectiveness.','Assume a clean photograph proves there was no exposure.'],2,'Anticipation and recognition lead to suitable evaluation, control and verification. Many occupational exposures cannot be judged from visible dirt or immediate symptoms.')],
 ESC03:[q('ESC03-K5','A proposed temporary safety-control bypass is technically possible. What must be established before it can be considered?',['Only that production will improve.','Only that someone can restore it later.','No review if the device has tripped before.','The authorized risk review, temporary protection, limits, communication, records and controlled restoration.'],3,'A bypass removes a defense. The defined authorization process must evaluate the actual hazard, maintain protection and control the duration/restoration; the course grants no bypass authority.')],
 ESC06:[q('ESC06-KC5','Why does process scale identified as possible TENORM require further evaluation?',['It can concentrate naturally occurring radioactive material and create exposure pathways requiring specific controls.','It is automatically nonhazardous because it is natural.','A normal dust mask proves every radiation pathway is controlled.','Its appearance proves its activity level.'],0,'Industrial processes can concentrate natural radioactivity. Identification, exposure assessment and specialized controls depend on actual material and conditions.'),q('ESC06-KC6','Which arrangement addresses respiratory infection risk in a shared indoor work setting?',['Blood-spill cleanup alone.','Appropriate ventilation, hygiene, illness reporting and risk-based exposure reduction.','Publicly posting every worker’s diagnosis.','Waiting until everyone has symptoms.'],1,'Respiratory spread differs from bloodborne exposure. Use measures suited to the transmission route while protecting private information.')],
 ESC08:[q('ESC08-KC5','Before moving an awkward box, which approach is most useful?',['Use one universal maximum weight to decide everything.','Keep feet fixed and twist while lifting.','Assess load, route, grip and posture, and obtain suitable mechanical or team assistance.','Move rapidly to reduce planning time.'],2,'Manual-handling exposure depends on the whole task. Plan assistance and movement, avoid excessive reach and twisting, and do not rely on a weight or posture slogan alone.')],
 ESC10:[q('ESC10-KC5','A worker is unsure whether a personal item is allowed at a new site. What is the appropriate response?',['Assume all sites use the previous employer’s rules.','Conceal the item before the gate check.','Disclose private medical information to the whole crew.','Check the actual policy through the designated process and protect private information.'],3,'Site restrictions and lawful procedures vary. Use the actual policy and confidential clarification channel; this training creates no universal search authority.'),q('ESC10-KC6','A worker feels overwhelmed and cannot concentrate safely. What should the team do?',['Protect against the immediate exposure and use the supervisor/support process respectfully.','Demand that the worker prove resilience by finishing the hazardous task.','Let coworkers diagnose the worker.','Ignore it until a reportable injury occurs.'],0,'Treat impaired concentration as a work-readiness concern. Safe task control and appropriate support are constructive responses; amateur diagnosis and stigma are not.')],
};

// Objective-specific checks replace broad topic associations in the benchmark map.
const focusedChecks={
 ESC01:[q('ESC01-K6','After repeated interruptions on a long shift, a worker nearly selects a similarly labeled valve. What is the best human-performance response?',[
 'Tell the worker to concentrate harder and continue at the same pace.',
 'Pause, verify the exact equipment against the instruction, and address the interruptions and fatigue with the work leader.',
 'Remove the similar label so there is less information to read.',
 'Let the most experienced worker select the valve from memory.'
 ],1,'Interruptions, similar identifiers and fatigue can defeat a capable person’s attention. Resolve the equipment identity before action and change the conditions that invite error. Experience or a warning to concentrate is not an independent safeguard.')],
 ESC02:[q('ESC02-K6','A delivery route crosses a maintenance area. Which is an administrative control, and what is its limitation?',[
 'Removing the need for deliveries; it depends entirely on a posted sign.',
 'A permanent vehicle barrier; it is only a written rule.',
 'Scheduling deliveries outside maintenance hours; it works only when the schedule and changes are coordinated and followed.',
 'Issuing gloves; it eliminates vehicle impact.'
 ],2,'Scheduling and controlled access organize work and are administrative controls. They need clear ownership, communication and enforcement when conditions change. They do not physically stop a vehicle; stronger separation or eliminating the conflict may still be necessary.')],
 ESC03:[q('ESC03-K6','A hose has a small suspected high-pressure leak. What should an awareness worker do?',[
 'Keep clear of jet and hose-whip paths, warn others and contact the responsible operator for controlled isolation and assessment.',
 'Pass a gloved hand over the hose to locate the leak.',
 'Tighten the connection while it is operating.',
 'Assume a small wet mark cannot cause a serious injury.'
 ],0,'High-pressure fluid can penetrate skin and a connection can release violently. A small mark does not establish low risk. Do not touch, tighten or disconnect an operating leak; protect the boundary and use authorized personnel. A suspected injection injury needs immediate medical assessment.')],
 ESC05:[q('ESC05-K5','A worker wears chemical-resistant gloves but sprays solvent near the breathing zone and later eats with contaminated hands. Which exposure routes remain relevant?',[
 'None, because gloves protect the whole body.',
 'Only noise exposure.',
 'Only exposure through intact glove material.',
 'Inhalation of airborne material and ingestion from contaminated hands, as well as any unprotected skin or eye contact.'
 ],3,'Different controls interrupt different exposure routes. Gloves do not remove vapor or spray from breathing air, and contamination can reach food during removal or handling. Evaluate the spray task, ventilation and other controls, then follow washing and clean-break arrangements.')],
 ESC06:[q('ESC06-KC7','After work with contaminated process dust, what is the appropriate preparation for a meal break?',[
 'Wipe gloves on work clothing and eat beside the task.',
 'Use the approved decontamination and handwashing method, keep contaminated items out of the clean eating area, and avoid spreading dust.',
 'Blow dust off skin and clothing with compressed air.',
 'Take dusty clothing home to shake out before returning.'
 ],1,'Workplace hygiene breaks hand-to-mouth transfer and prevents contamination of clean areas and homes. Use the material-specific washing and clothing arrangements. Compressed air and shaking dusty items can create inhalation exposure for other people.') ,q('ESC06-KC8','Workers must shout near a compressor, and one lifts an earmuff to hear instructions. What is the best response?',[
 'Treat shouting as a precise measurement showing a safe exposure.',
 'Continue because hearing damage would cause immediate pain.',
 'Seek the required noise assessment and source controls, keep suitable hearing protection correctly fitted, and establish a communication method that does not defeat it.',
 'Use any earplug found nearby without fitting instruction.'
 ],2,'Difficulty communicating is a reason to investigate noise, not a substitute for measurement. Noise can cause lasting hearing damage without immediate pain. Removing the seal reduces protection; improve the source or arrangement and use an agreed safe communication method with correctly selected and fitted protection.')],
 ESC08:[q('ESC08-KC6','A worker receives unfamiliar PPE for a new task. What must happen before relying on it?',[
 'Confirm the task hazard assessment and selected protection, obtain instruction on use and limitations, and demonstrate the required understanding and ability.',
 'Sign the receipt; the signature proves ability to use it.',
 'Select the largest available size to cover more area.',
 'Use it until a failure reveals its limitations.'
 ],0,'The employer’s selection and instruction must match the actual hazards, and the worker must understand and be able to use the protection where required. A receipt or this orientation alone does not demonstrate correct fit or use. Resolve uncertainty before exposure.'),q('ESC08-KC7','A crew proposes replacing a missing machine guard with heavier gloves. Why is that inadequate?',[
 'Gloves make all rotating machinery safe.',
 'A guard is only needed when the operator is inexperienced.',
 'Any PPE automatically outranks an engineering control.',
 'Gloves do not separate the body from the moving hazard and may add entanglement risk; restore the required guarding and safe method.'
 ],3,'PPE is a barrier for specified exposures, not a replacement for required guarding. A moving part can catch the glove and draw the hand in. Stop the affected operation and have authorized personnel restore protection instead of increasing reliance on personal equipment.'),q('ESC08-KC8','A repetitive powered-tool task requires a bent wrist and sustained hard grip. Which change best addresses tool ergonomics?',[
 'Tell workers to stretch before continuing the same excessive exposure.',
 'Review a suitable tool and handle, support the work at a better height, and reduce force, repetition and vibration through the task plan.',
 'Ask more workers to take turns without changing the exposure.',
 'Grip harder so discomfort becomes less noticeable.'
 ],1,'Ergonomic control changes the tool and task demands: fit, posture, support, required force and exposure duration. Stretching or rotating workers without meaningful exposure reduction does not correct a poorly designed task. Report symptoms early and reassess the method.')],
 ESC09:[q('ESC09-KC5','Before starting work at an unfamiliar remote pad, which emergency information must be resolved?',[
 'Only where a fire extinguisher is stored.',
 'Only the lease name, because every dispatcher knows it.',
 'The reporting method, location and access details, alarm actions, safe routes, assembly/accountability process and designated response roles.',
 'Nothing until an alarm identifies the emergency.'
 ],2,'Emergency planning must work for this location and the people present. Resolve how to summon and guide help and what each worker does on an alarm before exposure. A document or a familiar lease name does not guarantee responders can find the entrance.'),q('ESC09-KC6','During an evacuation the usual muster route is blocked and the alarm then stops. What should you do?',[
 'Use the planned safe alternative, report your location for accountability, and await authorized reentry instructions.',
 'Return to the task because silence proves the hazard is gone.',
 'Cross the hazard area to reach the usual muster sign.',
 'Leave the site without reporting so the entrance is less crowded.'
 ],0,'A route must be safe for the actual event. Use the alternative arrangements and make your location known so accountability remains accurate. Alarm silence is not an all-clear, and leaving unaccounted for can trigger an unnecessary search.')],
 ESC10:[q('ESC10-KC7','A new worker is mocked for asking about an unfamiliar alarm. What response supports respectful, safe work?',[
 'Join the teasing so the worker learns the crew’s culture.',
 'Tell the worker to sign the induction without asking questions.',
 'Publicize the worker’s personal background to explain the question.',
 'Stop the disrespect, ensure the alarm instructions are understood, and report repeated intimidation through the appropriate channel.'
 ],3,'Mocking questions suppresses information needed for safe work. Resolve the actual learning need and address intimidation without exposing private information. Respectful communication is a practical control for misunderstanding, especially for new or unfamiliar workers.'),q('ESC10-KC8','A worker receives a specific threatening message from someone expected at the site later. What should happen?',[
 'Wait for an assault before involving anyone.',
 'Report the specific threat promptly through the site security or supervisory process, preserve the message, and use emergency protection if danger becomes immediate.',
 'Confront the person alone to settle it before the shift.',
 'Circulate the message to everyone as entertainment.'
 ],1,'Specific threats need timely assessment by responsible people before an incident. Preserve relevant evidence without unnecessary circulation. Do not improvise a confrontation; when danger is immediate, move to safety and activate emergency help under the plan.')],
};
for(const [id,checks] of Object.entries(focusedChecks))additionalChecks[id]=[...(additionalChecks[id]??[]),...checks];
