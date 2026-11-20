import type { ShieldStatus } from '@workspace/api-zod/profile-status';
const files = { green: 'agreement-accepted', yellow: 'status-shield-yellow', red: 'status-shield-red', grey: 'status-shield-grey' };
export default function StatusShield({ status, label }: { status: ShieldStatus; label: string }) {
  return <img src={`/images/${files[status]}.png`} alt={label} title={label} data-status={status} className="h-6 w-6 shrink-0 object-contain" />;
}
