import { z } from 'zod/v4';

// These are recorded credentials, never VNDRLY/U course awards.
export const PROFILE_LICENSE_TYPES = [
  { id: 'driver', name: 'Driver license / CDL', es: 'Licencia de conducir / CDL', kind: 'license' },
  { id: 'hoisting', name: 'Crane / hoisting operator license', es: 'Licencia de operador de grúa / izaje', kind: 'license', equipment: true },
  { id: 'equipment-license', name: 'Other government equipment license', es: 'Otra licencia gubernamental de equipo', kind: 'license', equipment: true },
  { id: 'electrician', name: 'Electrician license', es: 'Licencia de electricista', kind: 'license' },
  { id: 'plumber', name: 'Plumber license', es: 'Licencia de plomero', kind: 'license' },
  { id: 'hvac', name: 'HVAC / refrigeration credential', es: 'Credencial de climatización / refrigeración', kind: 'regulatory' },
  { id: 'boiler', name: 'Boiler / stationary engineer license', es: 'Licencia de operador de calderas', kind: 'license' },
  { id: 'water-well', name: 'Water-well driller / pump installer license', es: 'Licencia de perforador de pozos de agua / instalador de bombas', kind: 'license' },
  { id: 'water', name: 'Water / wastewater operator license', es: 'Licencia de operador de agua / aguas residuales', kind: 'license' },
  { id: 'engineer', name: 'Professional engineer / surveyor license', es: 'Licencia de ingeniero profesional / topógrafo', kind: 'license' },
  { id: 'security', name: 'Security officer license', es: 'Licencia de guardia de seguridad', kind: 'license' },
  { id: 'pilot', name: 'FAA remote pilot certificate', es: 'Certificado FAA de piloto remoto', kind: 'regulatory' },
  { id: 'mariner', name: 'USCG merchant mariner credential', es: 'Credencial USCG de marino mercante', kind: 'regulatory' },
  { id: 'twic', name: 'TWIC access credential', es: 'Credencial de acceso TWIC', kind: 'regulatory' },
  { id: 'radiographer', name: 'Industrial radiographer regulatory ID', es: 'Identificación regulatoria de radiógrafo industrial', kind: 'regulatory' },
  { id: 'gas', name: 'Individual LPG / CNG / LNG credential', es: 'Credencial individual de GLP / GNC / GNL', kind: 'regulatory' },
  { id: 'explosives', name: 'Explosives employee-possessor clearance', es: 'Autorización de empleado poseedor de explosivos', kind: 'regulatory' },
  { id: 'medical', name: 'DOT medical examiner certificate', es: 'Certificado médico DOT', kind: 'regulatory' },
  { id: 'equipment-authorization', name: 'Employer equipment authorization', es: 'Autorización del empleador para operar equipo', kind: 'employer', equipment: true },
] as const;

const date = z.union([z.iso.date(), z.literal('')]);
export const ProfileLicenseBody = z.object({
  type: z.string().refine(value => PROFILE_LICENSE_TYPES.some(item => item.id === value), 'Choose a credential type'),
  issuer: z.string().trim().max(200),
  jurisdiction: z.string().trim().max(200),
  number: z.string().trim().max(200),
  scope: z.string().trim().max(1000),
  restrictions: z.string().trim().max(1000),
  issuedDate: date,
  expirationDate: date,
  noExpiration: z.boolean(),
  documentUrl: z.string().max(1000).refine(value => !value || /^\/(?:api\/storage|objects)\//.test(value), 'Use an uploaded document'),
  evaluationDate: date,
  evaluator: z.string().trim().max(200),
  trainingReference: z.string().trim().max(500),
}).strict().superRefine((data, ctx) => {
  // Capture what the person has available; missing details never block recording.
  if (data.noExpiration && data.expirationDate) ctx.addIssue({ code: 'custom', path: ['expirationDate'], message: 'Choose expiry or no expiration, not both' });
  if (data.issuedDate && data.expirationDate && data.expirationDate < data.issuedDate) ctx.addIssue({ code: 'custom', path: ['expirationDate'], message: 'Expiry must follow issue date' });
});
export type ProfileLicenseInput = z.infer<typeof ProfileLicenseBody>;
export type ProfileLicenseRecord = ProfileLicenseInput & { id: number };
