# Canonical Demo Credentials — DO NOT CHANGE

These passwords are fixed by the user across **every** environment (dev and prod) and across **every** restore, reseed, or DB sync. Any agent that "fixes", rotates, regenerates, or reseeds these passwords is wrong. The user has stated this explicitly multiple times.

| Username / Email                | Password      | Role           |
|---------------------------------|---------------|----------------|
| `admin@vndrly.com` / `admin`    | `vndrly123`   | admin          |
| `baker@vndrly.com` / `baker`    | `baker123`    | vendor         |
| `winchester@vndrly.com` / `Winchester@vndrly.com` / `winchester` | `winchester2` | vendor |
| `joe.boggs@winchester.com`      | `winchester2` | field_employee |
| `mach@vndrly.com` / `mach`      | `mach123`     | partner        |
| `exxon@vndrly.com` / `exxon`    | `exxon123`    | partner        |

## Rules for the agent

1. **Never** rotate, regenerate, or "fix" these passwords. They are correct as written.
2. After any DB restore / seed / sync, re-apply these exact passwords with bcrypt cost 10 — match by `LOWER(COALESCE(email, username))`, not by id.
3. If a login is failing, the right diagnosis is "the hash on disk doesn't match the canonical value above" — not "the password is wrong."
4. If you change the seed script's password generation, update it to use these exact values, not random ones, not env-driven ones.
5. Do **not** prompt the user for new credentials, do **not** suggest stronger passwords, do **not** rotate "for security." This is a demo dataset.

## Re-applying after a restore (script)

```ts
import bcrypt from "bcryptjs";
const PWS: Record<string, string> = {
  vndrly123: "admin@vndrly.com,admin",
  baker123: "baker@vndrly.com,baker",
  winchester2: "winchester@vndrly.com,Winchester@vndrly.com,winchester,joe.boggs@winchester.com",
  mach123: "mach@vndrly.com,mach",
  exxon123: "exxon@vndrly.com,exxon",
};
for (const [pw, csv] of Object.entries(PWS)) {
  const hash = await bcrypt.hash(pw, 10);
  const ids = csv.split(",").map(s => `'${s.toLowerCase()}'`).join(",");
  await db.execute(sql.raw(
    `UPDATE users SET password_hash = '${hash}' WHERE LOWER(COALESCE(email, username)) IN (${ids})`
  ));
}
```
