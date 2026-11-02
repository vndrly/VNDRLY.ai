import OptionSwitch from "./library/option-switch";
import type { RepositoryData } from "./repository-client";
export type Audience = {
  userIds: number[];
  groupIds: string[];
  roles: string[];
};
export const emptyAudience: Audience = { userIds: [], groupIds: [], roles: [] };
export function RepositoryAudience({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: Audience;
  onChange: (v: Audience) => void;
  options: RepositoryData["options"];
  disabled?: boolean;
}) {
  const toggle = (key: keyof Audience, id: number | string, on: boolean) =>
    onChange({
      ...value,
      [key]: on
        ? [...new Set([...value[key], id])]
        : value[key].filter((v) => v !== id),
    });
  return (
    <div className="space-y-2">
      {(
        [
          {
            key: "userIds",
            label: "Individuals",
            items: options.people.map((p) => ({ id: p.userId, name: p.name })),
          },
          { key: "groupIds", label: "Groups", items: options.groups },
          {
            key: "roles",
            label: "Positions",
            items: [...options.accountTypes, ...options.positions],
          },
        ] as const
      ).map((section) => (
        <details key={section.key}>
          <summary className="cursor-pointer py-2 font-semibold">
            {section.label} · {value[section.key].length}
          </summary>
          <div className="space-y-2 py-2">
            {section.items.map((item) => (
              <OptionSwitch
                key={item.id}
                label={item.name}
                value={(value[section.key] as (string | number)[]).includes(
                  item.id,
                )}
                disabled={disabled}
                onChange={(on) => toggle(section.key, item.id, on)}
              />
            ))}
            {!section.items.length && (
              <p>No defined {section.label.toLowerCase()}.</p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
