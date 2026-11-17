import { useState } from 'react';
import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import { certificationProgram } from '@workspace/api-zod/certification-program-links';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BrandedInput as Input } from '@/components/work-hub/chrome';
import './certification-picker.css';

export function CertificationPicker({ names, value, placeholder, onChange, testId, label = 'Name' }: {
  names: string[]; value?: string; placeholder: string; onChange: (name: string) => void; testId: string; label?: string;
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
          return <div className="certification-choice-row" key={name}>
            <button type="button" className="certification-choice" aria-label={name} aria-pressed={value === name} onClick={() => { setOpen(false); onChange(name); }}>
              <span className="certification-choice-name" title={name}>{name}</span>
              {value === name && <Check size={14} className="shrink-0" aria-hidden="true" />}
            </button>
            {program && <a className="certification-program-link" href={`/work-hub/bundle/${program.id}`} target="_blank" rel="noopener noreferrer" aria-label={`VNDRLY/U Cert: ${program.title}`} title={program.title}>
              <span>VNDRLY/U<br />Cert</span><ExternalLink size={12} aria-hidden="true" />
            </a>}
          </div>;
        })}
        {!options.length && <p className="p-3 text-sm">No matching certifications.</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
