import { useState } from 'react';
import { Link } from 'wouter';
import { Check, ChevronDown } from 'lucide-react';
import { certificationProgram } from '@workspace/api-zod/certification-program-links';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BrandedInput as Input } from '@/components/work-hub/chrome';
import './certification-picker.css';

export type CertificationLogoStatus = 'unassigned' | 'assigned' | 'completed';
export function CertificationPicker({ names, value, placeholder, onChange, testId, label = 'Name', programStatuses = {} }: {
  names: string[]; value?: string; placeholder: string; onChange: (name: string) => void; testId: string; label?: string;
  programStatuses?: Record<string, CertificationLogoStatus>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const options = names.filter(name => name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setSearch(''); }}>
    <PopoverTrigger asChild>
      <button type="button" className="app-select-trigger certification-picker-trigger" data-testid={testId} aria-label={`${label}: ${value || placeholder}`} disabled={!names.length}>
        <span className="certification-choice-name" title={value}>{value || placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-[var(--brand-primary)]" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" collisionPadding={12} className="certification-picker-menu" aria-label="Certification choices">
      <Input className="certification-picker-search" aria-label="Search certifications" placeholder="Search certifications" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="certification-picker-choices">
        {options.map(name => {
          const program = certificationProgram(name);
          const status = program ? programStatuses[program.id] ?? 'unassigned' : 'unassigned';
          return <div className="certification-choice-row" key={name}>
            <button type="button" className="certification-choice" aria-label={name} aria-pressed={value === name} onClick={() => { setOpen(false); onChange(name); }}>
              <span className="certification-choice-name" title={name}>{name}</span>
              {value === name && <Check size={14} className="shrink-0" aria-hidden="true" />}
            </button>
            {program && <Link className="certification-program-link" href={`/work-hub/bundle/${program.id}`} aria-label={`VNDRLY/U Cert: ${program.title}`} title={`${program.title} — ${status === 'completed' ? 'Completed' : status === 'assigned' ? 'Assigned, incomplete' : 'Unassigned'}`} data-status={status}>
              <img src={`${import.meta.env.BASE_URL}images/vndrly-u/${status}.png`} alt={status === 'completed' ? 'Completed' : status === 'assigned' ? 'Assigned, incomplete' : 'Unassigned'} />
            </Link>}
          </div>;
        })}
        {!options.length && <p className="p-3 text-sm">No matching certifications.</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
