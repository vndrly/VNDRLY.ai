import { expect, it } from 'vitest';
import { EXTERNAL_CERTIFICATION_CATALOG } from './external-certification-catalog';
it('provides 50 distinct credential types with scoped evidence fields and official sources',()=>{
 expect(EXTERNAL_CERTIFICATION_CATALOG).toHaveLength(50);
 expect(new Set(EXTERNAL_CERTIFICATION_CATALOG.map(c=>c.name)).size).toBe(50);
 for(const c of EXTERNAL_CERTIFICATION_CATALOG){expect(c.fields.length).toBeGreaterThan(0);expect(c.source).toMatch(/^https:\/\//);}
 expect(EXTERNAL_CERTIFICATION_CATALOG.find(c=>c.name==='Pipeline Operator Qualification (OQ)')?.fields).toContain('Covered task IDs');
});
