import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PROFILE_LICENSE_TYPES, ProfileLicenseBody, type ProfileLicenseInput, type ProfileLicenseRecord } from '@workspace/api-zod/profile-licenses';
import { ProfileActionButton, ProfileRow, profileRequest } from './gate-profile-chrome';
import { BrandedInput, BrandedSelect } from './work-hub/chrome';
import { Dialog } from './ui/dialog';
import EmployeeDialogContent from './employee-dialog-content';

const empty: ProfileLicenseInput = { type: 'driver', issuer: '', jurisdiction: '', number: '', scope: '', restrictions: '', issuedDate: '', expirationDate: '', noExpiration: false, documentUrl: '', evaluationDate: '', evaluator: '', trainingReference: '' };

export function ProfileLicenses({ employeeId }: { employeeId: number }) {
  const { i18n } = useTranslation();
  const es = i18n.language.startsWith('es');
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [expanded, setExpanded] = useState(false), [editor, setEditor] = useState(false);
  const [editing, setEditing] = useState<number | null>(null), [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const cache = useQueryClient(), path = `/field-employees/${employeeId}/licenses`;
  const query = useQuery({ queryKey: ['profile-licenses', employeeId], queryFn: () => profileRequest<ProfileLicenseRecord[]>(path), enabled: expanded });
  const type = PROFILE_LICENSE_TYPES.find(item => item.id === form.type)!;
  const equipment = 'equipment' in type;
  const employer = type.kind === 'employer';
  const refresh = () => cache.invalidateQueries({ queryKey: ['profile-licenses', employeeId] });
  async function action(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : c('Could not save record', 'No se pudo guardar')); return false; }
    finally { setBusy(false); }
  }
  async function save() {
    const parsed = ProfileLicenseBody.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the form'); return; }
    if (await action(() => profileRequest(editing ? `${path}/${editing}` : path, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(parsed.data) }))) setEditor(false);
  }
  async function upload(file?: File) {
    if (!file) return;
    await action(async () => {
      const { uploadURL, objectPath } = await profileRequest<{ uploadURL: string; objectPath: string }>('/storage/uploads/request-url', { method: 'POST', body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) });
      const response = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw Error(c('Upload failed', 'Error al subir'));
      await profileRequest('/storage/uploads/finalize', { method: 'POST', body: JSON.stringify({ objectURL: uploadURL, visibility: 'private' }) });
      setForm(current => ({ ...current, documentUrl: `/api/storage${objectPath}` }));
    });
  }
  function edit(row?: ProfileLicenseRecord) {
    setEditing(row?.id ?? null);
    setForm(row ? Object.fromEntries(Object.keys(empty).map(key => [key, row[key as keyof ProfileLicenseInput]])) as ProfileLicenseInput : { ...empty });
    setError(''); setEditor(true);
  }
  const field = (key: Exclude<keyof ProfileLicenseInput, 'noExpiration'>, label: string, date = false) => <label className="grid gap-1 text-sm">{label}<BrandedInput type={date ? 'date' : 'text'} value={form[key]} disabled={busy} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></label>;
  const rows = query.data ?? [];
  const group = (employerGroup: boolean) => <ul className="space-y-3">{rows.filter(row => (row.type === 'equipment-authorization') === employerGroup).map(row => {
    const definition = PROFILE_LICENSE_TYPES.find(item => item.id === row.type);
    const expired = row.expirationDate && row.expirationDate < new Date().toLocaleDateString('en-CA');
    return <li key={row.id} className="rounded border p-3 text-sm space-y-2">
      <strong>{es ? definition?.es : definition?.name}</strong>
      <p>{row.issuer} · {row.jurisdiction || row.scope}</p>
      <p>{row.number && `${row.number} · `}{expired ? c('Expired', 'Vencida') : row.expirationDate ? c('Expires', 'Vence') : c('No expiration recorded', 'Sin vencimiento registrado')} {row.expirationDate}</p>
      {row.scope && <p>{c('Scope', 'Alcance')}: {row.scope}</p>}
      {row.restrictions && <p>{c('Restrictions', 'Restricciones')}: {row.restrictions}</p>}
      {row.evaluationDate && <p>{c('Evaluation', 'Evaluación')}: {row.evaluationDate} · {row.evaluator}</p>}
      {row.trainingReference && <p>{c('Supporting evidence', 'Evidencia de respaldo')}: {row.trainingReference}</p>}
      <div className="flex flex-wrap gap-2">
        {row.documentUrl && <a className="underline" href={row.documentUrl} target="_blank" rel="noreferrer">{c('View document', 'Ver documento')}</a>}
        <ProfileActionButton onClick={() => edit(row)}>{c('Edit', 'Editar')}</ProfileActionButton>
        <ProfileActionButton disabled={busy} onClick={() => { if (window.confirm(c('Remove this record?', '¿Eliminar este registro?'))) void action(() => profileRequest(`${path}/${row.id}`, { method: 'DELETE' })); }}>{c('Remove', 'Eliminar')}</ProfileActionButton>
      </div>
    </li>;
  })}</ul>;
  return <>
    <ProfileRow label={c('Licenses & regulatory credentials', 'Licencias y credenciales regulatorias')} open={expanded} onClick={() => setExpanded(value => !value)} unframed>
      <p className="text-sm">{c('Add licenses or other regulatory credentials. Training completion does not issue a government license or employer permission to operate equipment.', 'Agrega licencias u otras credenciales regulatorias. Completar capacitación no otorga una licencia gubernamental ni permiso del empleador para operar equipo.')}</p>
      {query.isPending && <p>{c('Loading…', 'Cargando…')}</p>}
      {query.isError && <p role="alert">{c('Could not load records.', 'No se pudieron cargar los registros.')} <button onClick={() => void query.refetch()}>{c('Retry', 'Reintentar')}</button></p>}
      {!query.isPending && !query.isError && rows.length === 0 && <p>{c('No records added.', 'Sin registros.')}</p>}
      {group(false)}
      {rows.some(row => row.type === 'equipment-authorization') && <><h4 className="font-semibold">{c('Employer equipment authorizations', 'Autorizaciones del empleador para equipo')}</h4>{group(true)}</>}
      <ProfileActionButton onClick={() => edit()}>{c('Add record', 'Agregar registro')}</ProfileActionButton>
      {error && !editor && <p role="alert">{error}</p>}
    </ProfileRow>
    <Dialog open={editor} onOpenChange={setEditor}>
      <EmployeeDialogContent title={c('License or authorization record', 'Registro de licencia o autorización')} appearance="dark">
        <label className="grid gap-1 text-sm">{c('Record type', 'Tipo de registro')}<BrandedSelect value={form.type} disabled={busy} onChange={event => setForm(current => ({ ...current, type: event.target.value }))}>{PROFILE_LICENSE_TYPES.map(item => <option key={item.id} value={item.id}>{es ? item.es : item.name}</option>)}</BrandedSelect></label>
        <p className="text-sm">{c('Add the details you have. All fields below are optional.', 'Agrega los datos disponibles. Todos los campos siguientes son opcionales.')}</p>
        {equipment && <p className="text-sm">{employer ? c('Employer equipment authorization, separate from a government license.', 'Autorización del empleador para equipo, separada de una licencia gubernamental.') : c('Government-issued equipment license. Employer authorization is a separate record type.', 'Licencia de equipo emitida por el gobierno. La autorización del empleador es otro tipo de registro.')}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field('issuer', employer ? c('Authorizing employer', 'Empleador que autoriza') : c('Issuing authority', 'Autoridad emisora'))}
          {field('jurisdiction', employer ? c('Site / jurisdiction', 'Sitio / jurisdicción') : c('Issuing jurisdiction', 'Jurisdicción emisora'))}
          {field('number', c('Record number', 'Número de registro'))}
          {field('scope', equipment ? c('Equipment classes / models / capacities', 'Clases / modelos / capacidades de equipo') : c('Class / endorsements / scope', 'Clase / endosos / alcance'))}
          {field('restrictions', c('Restrictions', 'Restricciones'))}
          {field('issuedDate', c('Issue date', 'Fecha de emisión'), true)}
          {!form.noExpiration && field('expirationDate', c('Expiration date', 'Fecha de vencimiento'), true)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.noExpiration} disabled={busy} onChange={event => setForm(current => ({ ...current, noExpiration: event.target.checked, expirationDate: '' }))} />{c('No expiration stated by issuer', 'El emisor no indica vencimiento')}</label>
          {employer && <>{field('evaluationDate', c('Equipment evaluation date', 'Fecha de evaluación del equipo'), true)}{field('evaluator', c('Evaluator / authorizing person', 'Evaluador / persona que autoriza'))}{field('trainingReference', c('Training / evaluation evidence reference', 'Referencia de capacitación / evaluación'))}</>}
        </div>
        <label className="text-sm">{c('Supporting document', 'Documento de respaldo')}<input type="file" accept="image/*,application/pdf" disabled={busy} onChange={event => void upload(event.target.files?.[0])} /></label>
        {form.documentUrl && <p>{c('Document attached', 'Documento adjunto')}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="flex justify-end gap-2"><ProfileActionButton disabled={busy} onClick={() => setEditor(false)}>{c('Cancel', 'Cancelar')}</ProfileActionButton><ProfileActionButton disabled={busy} onClick={() => void save()}>{c('Save record', 'Guardar registro')}</ProfileActionButton></div>
      </EmployeeDialogContent>
    </Dialog>

  </>;
}
