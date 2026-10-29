/** Identity checks for existing fictional companies survive edits to About Us. */
export function isCompanyGoFixture(row, marker) {
  if (row.blurb === marker) return true;
  const expected = row.kind === 'partner' && row.name === 'GasGo' ? 'SYN-TX-0001'
    : row.kind === 'vendor' && ['FieldGo','FleetGo','GateGo'].includes(row.name) ? `SYN-TX-${row.name.toLowerCase()}` : null;
  return expected !== null && row.state_tax_id === expected && row.canonical_admin === true;
}
export const existingCompanyGoQuery = `
select 'partner' kind,p.id,p.name,p.blurb,p.state_tax_id,
 exists(select 1 from user_org_memberships m join users u on u.id=m.user_id where m.org_type='partner' and m.partner_id=p.id and m.role='admin' and lower(u.username)='partner_admin@gasgo.com') canonical_admin
from partners p where lower(btrim(p.name))=any($1)
union all
select 'vendor',v.id,v.name,v.blurb,v.state_tax_id,
 exists(select 1 from user_org_memberships m join users u on u.id=m.user_id where m.org_type='vendor' and m.vendor_id=v.id and m.role='admin' and lower(u.username)='vendor_admin@'||lower(btrim(v.name))||'.com')
from vendors v where lower(btrim(v.name))=any($1)`;
