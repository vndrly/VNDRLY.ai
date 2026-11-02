import { useState } from "react";
import { FolderPlus, FolderLock, Plane, ShieldCheck } from "lucide-react";
import { useRepository, type RepositoryData } from "./repository-client";
import {
  RepositoryAudience,
  emptyAudience,
  type Audience,
} from "./repository-audience";
import OptionSwitch from "./library/option-switch";
import { BrandedSelect } from "./chrome";
export function RepositoryFolders({
  onSelect,
}: { onSelect?: (id: string, category: string) => void } = {}) {
  const repo = useRepository();
  const [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(""),
    [audience, setAudience] = useState<Audience>(emptyAudience),
    [permissions, setPermissions] = useState({
      read: true,
      write: false,
      edit: false,
    }),
    [grantUsers, setGrantUsers] = useState<number[] | null>(null);
  const [parentId, setParentId] = useState("");
  const [otherGrants, setOtherGrants] = useState<Record<string, any>[]>([]);
  if (!repo.data) return null;
  const d = repo.data;
  const save = async () => {
    await repo.save({
      action: "folder",
      version: d.folders.find((f) => f.id === editing)?.data.version ?? null,
      payload: {
        ...(editing !== "new" ? { id: editing } : {}),
        name,
        parentId: parentId || null,
        category: name,
        protected: true,
        grants: [{ ...audience, ...permissions }, ...otherGrants],
      },
    });
    setEditing(null);
    setName("");
    setAudience(emptyAudience);
  };
  return (
    <section className="repository-card space-y-2">
      <h2 className="flex gap-2">
        <FolderLock className="h-4 w-4 text-[var(--brand-primary)]" />
        Logical folders
      </h2>
      <div className="flex flex-wrap gap-2">
        {d.folders.map((f) => (
          <div key={f.id} className="flex gap-1">
            <button
              className="repo-action"
              onClick={() => onSelect?.(f.id, f.data.category)}
            >
              {f.data.name}
            </button>
            {d.canAdmin && (
              <button
                className="repo-action"
                aria-label={`Edit ${f.data.name} permissions`}
                onClick={() => {
                  setEditing(f.id);
                  setName(f.data.name);
                  setParentId(f.data.parentId ?? "");
                  setOtherGrants((f.data.grants ?? []).slice(1));
                  const grant = f.data.grants?.[0];
                  setAudience(
                    grant
                      ? {
                          userIds: grant.userIds ?? [],
                          groupIds: grant.groupIds ?? [],
                          roles: grant.roles ?? [],
                        }
                      : emptyAudience,
                  );
                  setPermissions(
                    grant
                      ? {
                          read: grant.read,
                          write: grant.write,
                          edit: grant.edit,
                        }
                      : { read: true, write: false, edit: false },
                  );
                }}
              >
                Edit
              </button>
            )}
          </div>
        ))}
        {d.canAdmin && (
          <>
            <button
              className="repo-action"
              onClick={() => {
                setEditing(editing ? null : "new");
                setName("");
                setParentId("");
                setAudience(emptyAudience);
                setOtherGrants([]);
                setPermissions({ read: true, write: false, edit: false });
              }}
            >
              <FolderPlus size={15} />
              Add folder/category
            </button>
            {!d.folders.some((f) => f.data.category === "Travel") && (
              <button
                className="repo-action"
                disabled={repo.pending}
                onClick={() =>
                  void repo.save({ action: "travel-setup", payload: {} })
                }
              >
                <Plane size={15} />
                Create Travel and working templates
              </button>
            )}
          </>
        )}
      </div>
      {d.canAdmin && editing && (
        <div className="space-y-2">
          <label className="block">
            Folder/category name
            <input
              className="block rounded border p-2 w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Parent folder
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">Top level</option>
              {d.folders
                .filter((f) => f.id !== editing)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.data.name}
                  </option>
                ))}
            </select>
          </label>
          <RepositoryAudience
            value={audience}
            onChange={setAudience}
            options={d.options}
          />
          {(["read", "write", "edit"] as const).map((p) => (
            <OptionSwitch
              key={p}
              label={p[0].toUpperCase() + p.slice(1)}
              value={permissions[p]}
              onChange={(v) => setPermissions({ ...permissions, [p]: v })}
            />
          ))}
          {otherGrants.map((grant, index) => (
            <div className="repository-card" key={index}>
              <RepositoryAudience
                value={{
                  userIds: grant.userIds ?? [],
                  groupIds: grant.groupIds ?? [],
                  roles: grant.roles ?? [],
                }}
                onChange={(value) =>
                  setOtherGrants((current) =>
                    current.map((g, i) =>
                      i === index ? { ...g, ...value } : g,
                    ),
                  )
                }
                options={d.options}
              />
              {(["read", "write", "edit"] as const).map((permission) => (
                <OptionSwitch
                  key={permission}
                  label={permission[0].toUpperCase() + permission.slice(1)}
                  value={!!grant[permission]}
                  onChange={(value) =>
                    setOtherGrants((current) =>
                      current.map((g, i) =>
                        i === index ? { ...g, [permission]: value } : g,
                      ),
                    )
                  }
                />
              ))}
              <button
                className="repo-action"
                onClick={() =>
                  setOtherGrants((current) =>
                    current.filter((_, i) => i !== index),
                  )
                }
              >
                Remove permission rule
              </button>
            </div>
          ))}
          <button
            className="repo-action"
            onClick={() =>
              setOtherGrants((current) => [
                ...current,
                { ...emptyAudience, read: true, write: false, edit: false },
              ])
            }
          >
            Add permission rule
          </button>
          <button
            className="repo-action"
            disabled={repo.pending || !name.trim()}
            onClick={() => void save()}
          >
            Save folder
          </button>
        </div>
      )}
      {d.canAdmin && (
        <details>
          <summary className="font-semibold cursor-pointer flex gap-2 items-center">
            <ShieldCheck size={15} />
            Assign Travel role
          </summary>
          <p>
            Admins have access. Grant Office Staff read, write, edit and assign
            authority for Travel.
          </p>
          {d.options.people
            .filter((p) => p.role !== "admin" && p.canAssignTravelRole)
            .map((p) => (
              <OptionSwitch
                key={p.userId}
                label={p.name}
                value={(
                  grantUsers ??
                  d.travelGrants[0]?.data.userIds ??
                  []
                ).includes(p.userId)}
                onChange={(on) => {
                  const current =
                    grantUsers ?? d.travelGrants[0]?.data.userIds ?? [];
                  setGrantUsers(
                    on
                      ? [...current, p.userId]
                      : current.filter((id: number) => id !== p.userId),
                  );
                }}
              />
            ))}
          <button
            className="repo-action"
            disabled={repo.pending || grantUsers === null}
            onClick={async () => {
              await repo.save({
                action: "travel-grant",
                payload: { userIds: grantUsers },
                version: d.travelGrants[0]?.data.version ?? null,
              });
              setGrantUsers(null);
            }}
          >
            Save Assign Travel role
          </button>
        </details>
      )}
      {repo.error && <p role="alert">{repo.error}</p>}
    </section>
  );
}
export function FolderPicker({
  data,
  value,
  onChange,
  disabled = false,
}: {
  data?: RepositoryData;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-wrap gap-2 items-center">
      Add to…
      <BrandedSelect
        aria-label="Add to logical folder"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">General repository</option>
        {data?.folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.data.name}
          </option>
        ))}
      </BrandedSelect>
    </label>
  );
}
