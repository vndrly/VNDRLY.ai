# Fleet work templates and exact commercial amounts

Work templates are available inside **Inventory and Details → Work templates** on web and iOS. They configure an existing offered vendor service; they never create a catalog offering, authorize a customer relationship, approve a price, or classify cargo legally. Ask V and the installed plugin use the same scoped reads and confirmed original-command save.

Ten editable starting families are provided: crude/condensate; water/brine/flowback; vacuum/pump/recovery; equipment/heavy haul; hotshot/parts/materials; bulk/aggregate; support/resupply; authorized waste/disposal; towing/recovery; vendor defined. Every starting point is disabled. An authorized manager or dispatcher explicitly enables a reviewed revision for future activities.

Commodity, equipment capabilities, inspection/manifest/evidence requirements and suggested pricing basis are independent. A suggested basis is not a negotiated agreement. Optional starter evidence is not a legal checklist or a waiver of a mandatory group requirement. Existing mandatory requirements are combined with template requirements, and conflicting requirement identities are refused. Waste, hazardous materials, tanker endorsements, insurance and permits still require their actual applicable reviewed facts.

Each new activity captures the exact enabled template revision alongside its approved commercial and resource context. Editing a template never rewrites an earlier activity. Previously captured offline work retains its original known revision; unknown or modified snapshots require reconciliation. An offered service removed from the catalog does not become authorized because a historical template exists.

Template saves use the durable original command, exact revision checks and canonical readback. A lost response retries the same operation. A pending template does not disable other offered-service configuration or driver fact capture. Templates and other commercial v2 changes remain behind the commercial-work feature gate until integrated acceptance is complete.

## Money boundaries

Reported quantities and approved rates remain decimal strings. Multiplication retains exact intermediate precision; payable currency is rounded at the defined currency boundary using the reviewed agreement. For example, `123.456789 × 0.0125 = 1.5432098625`, payable `1.54` at two decimal places. `123.456789 × 0.000125 = 0.015432098625`, payable `0.02`. Half values round away from zero (`-1.005` becomes `-1.01`). The supported input precision is nine decimal places; excess precision is refused, never silently truncated.

Reviewed payable lines, signed adjustments, reimbursements, minimum top-ups and named-base surcharges retain their source identities. Summing 500 approved `0.02` charges plus `2.50` yields exactly `12.50`. Pure historical v1 lines retain their existing calculation behavior. Tax is separately governed by the existing reviewed jurisdiction/exemption rules; these templates make no universal taxable or exempt hauling assumption. Payroll and internal fuel/cost records are not partner charges.
