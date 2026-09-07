# API Error Code Catalog

This document is the source of truth for the structured error codes the
API returns in the `{ error: <snake_case_code>, message }` payload shape
introduced by Tasks #509 / #517 / #527. Frontends look these up under the
`errors.<code>` key in their i18n catalog (see
`artifacts/vndrly/src/lib/api-error.ts` and
`artifacts/vndrly-mobile/lib/apiErrors.ts`).

If you add a new `res.status(...).json({ error: "..." })` to a handler:

1. Add a row to the table below (alphabetised).
2. Add the matching `errors.<code>` key to **all four** locale files:
   - `artifacts/vndrly/src/lib/locales/en.json`
   - `artifacts/vndrly/src/lib/locales/es.json`
   - `artifacts/vndrly-mobile/lib/locales/en.json`
   - `artifacts/vndrly-mobile/lib/locales/es.json`
3. Run `pnpm --filter @workspace/api-server test` — the
   `error-code-i18n-coverage` test will fail CI if any code emitted by
   `tickets.ts`, `ticketSchedule.ts`, `locations.ts`, `hotlist.ts`, or
   `field.ts` is missing from any of the four catalogs.

The legacy dotted `code` field (e.g. `ticket.not_found`,
`auth.not_authenticated`) is still emitted by some handlers and remains
mapped to nested keys in the locale catalogs. New handlers should prefer
the snake_case `error` field.

## Codes emitted by `artifacts/api-server/src/routes/tickets.ts`

| Code | HTTP | Route(s) | EN message | ES message |
| --- | --- | --- | --- | --- |
| `crew_invalid_for_vendor` | 400 | `POST /api/tickets/:id/schedule` | One or more crew members aren't on this vendor. | Uno o más miembros del equipo no pertenecen a este proveedor. |
| `deny_reason_required` | 400 | `POST /api/tickets/:id/deny` | Please enter a reason. | Ingresa una razón. |
| `deny_reason_too_long` | 400 | `POST /api/tickets/:id/deny` | Reason must be 500 characters or fewer. | La razón debe tener 500 caracteres o menos. |
| `field_employee_vendor_mismatch` | 400 | `PATCH /api/tickets/:id` | That field employee doesn't belong to this ticket's vendor. | Ese empleado de campo no pertenece al proveedor de este ticket. |
| `forbidden_admin_only` | 403 | `POST /api/tickets/:id/unlock`, `POST /api/tickets/:id/reactivate`, `POST /api/tickets/:id/reverse-funds-dispersal` | Only admins can do that. | Solo los administradores pueden hacer eso. |
| `forbidden_not_ap` | 403 | `POST /api/tickets/:id/disperse-funds` | Only Accounts Payable or an admin can disperse funds. | Solo Cuentas por Pagar o un administrador pueden dispersar fondos. |
| `forbidden_not_assigned` | 403 | `POST /api/tickets/:id/awaiting-payment` | Only the assigned vendor or field employee can do that. | Solo el proveedor asignado o el empleado de campo pueden hacer eso. |
| `forbidden_not_invited_vendor` | 403 | `POST /api/tickets/:id/accept`, `POST /api/tickets/:id/deny` | Only the invited vendor can act on this ticket. | Solo el proveedor invitado puede actuar sobre este ticket. |
| `forbidden_not_owning_partner` | 403 | `POST /api/tickets/:id/approve`, `POST /api/tickets/:id/reinvite` | Only the owning partner can do that. | Solo el socio dueño puede hacer eso. |
| `foreman_field_employee_mismatch` | 400 | `POST /api/tickets` | The foreman must match the assigned field employee. | El capataz debe coincidir con el empleado de campo asignado. |
| `foreman_vendor_mismatch` | 400 | `POST /api/tickets` | That foreman isn't on this vendor. Pick a different field employee. | Ese capataz no pertenece a este proveedor. Elige otro empleado de campo. |
| `hotlist_job_not_open` | 409 | `POST /api/tickets/direct-award` | This hotlist job is no longer open. | Este trabajo del Hotlist ya no está abierto. |
| `hotlist_job_state_changed` | 409 | `POST /api/tickets/direct-award` | Someone else awarded this hotlist job — refresh and try again. | Alguien más adjudicó este trabajo del Hotlist — actualiza e inténtalo de nuevo. |
| `invalid_awaiting_payment_body` | 400 | `POST /api/tickets/:id/awaiting-payment` | That awaiting-payment request is invalid. | Esa solicitud de espera de pago no es válida. |
| `invalid_reverse_funds_body` | 400 | `POST /api/tickets/:id/reverse-funds-dispersal` | The reversal request was invalid. Please check the reason and try again. | La solicitud de reversión no es válida. Revisa el motivo e intenta de nuevo. |
| `invalid_ticket_id` | 400 | `POST /api/tickets/:id/en-route`, `POST /api/tickets/:id/accept`, `POST /api/tickets/:id/deny`, `POST /api/tickets/:id/reinvite`, `POST /api/tickets/:id/reactivate`, `POST /api/tickets/:id/schedule`, `POST /api/tickets/:id/awaiting-payment` | That ticket id is invalid. | El ID del ticket no es válido. |
| `not_authenticated` | 401 | `POST /api/tickets/:id/approve`, `POST /api/tickets/:id/disperse-funds`, `POST /api/tickets/:id/unlock`, `POST /api/tickets/:id/schedule`, `GET /api/tickets/:id/schedule`, `GET /api/tickets/:id/crew-tracker`, `GET /api/tickets/:id/schedule.ics`, `POST /api/tickets/:id/awaiting-payment` | Please sign in to continue. | Inicia sesión para continuar. |
| `open_crew_sessions` | 409 | `POST /api/tickets/:id/submit` | Some crew members are still checked in. Check them out before submitting. | Algunos miembros del equipo siguen registrados. Regístralos antes de enviar. |
| `payment_reference_required` | 400 | `POST /api/tickets/:id/disperse-funds` | A payment reference (check #) is required. | Se requiere una referencia de pago (# de cheque). |
| `reverse_funds_reason_required` | 400 | `POST /api/tickets/:id/reverse-funds-dispersal` | A reason is required to reverse the payment. | Se requiere un motivo para revertir el pago. |
| `phone_intake_role_required` | 403 | `POST /api/tickets` | Phone intake requires admin or vendor office access. | La toma por teléfono requiere acceso de administrador u oficina del proveedor. |
| `site_inactive` | 409 | `POST /api/tickets`, `POST /api/field/tickets` | This site is inactive due to a safety stop-work event. | Este sitio está inactivo por una orden de alto al trabajo de seguridad. |
| `site_not_found` | 400 | `POST /api/tickets` | We couldn't find that site. Pick a different one. | No encontramos ese sitio. Elige otro. |
| `site_not_geocoded` | 400 | `POST /api/tickets/direct-award` | Site is not geocoded — vendor radius can't be verified. | El sitio no está geolocalizado — no se puede verificar el radio del proveedor. |
| `site_vendor_mismatch` | 400 | `POST /api/tickets`, `POST /api/tickets/:id/check-in`, `POST /api/tickets/:id/check-out`, `POST /api/tickets/:id/en-route`, `POST /api/tickets/:id/submit` | Your vendor isn't assigned to work at this site. Pick a different one. | Tu proveedor no está asignado a trabajar en este sitio. Elige otro. |
| `ticket_en_route_invalid_state` | 409 | `POST /api/tickets/:id/en-route` | You can't mark this ticket en route in its current state. | No puedes marcar este ticket en ruta en su estado actual. |
| `ticket_not_accepted` | 409 | `POST /api/tickets/:id/check-out`, `POST /api/tickets/:id/submit`, `POST /api/tickets/:id/kickback`, `POST /api/tickets/:id/cancel` | This ticket must be accepted before that action. | Este ticket debe aceptarse antes de esa acción. |
| `ticket_not_approved` | 409 | `POST /api/tickets/:id/disperse-funds` | Funds can only be dispersed on an approved ticket. | Solo se pueden dispersar fondos en un ticket aprobado. |
| `ticket_not_awaiting_acceptance` | 409 | `POST /api/tickets/:id/accept`, `POST /api/tickets/:id/deny` | This invite has already been responded to. | Esta invitación ya fue respondida. |
| `ticket_not_cancelled` | 400 | `POST /api/tickets/:id/reactivate` | Ticket is not cancelled and cannot be reactivated. | El ticket no está cancelado y no se puede reactivar. |
| `ticket_not_checkinable` | 409 | `POST /api/tickets/:id/check-in` | This ticket can't be checked in right now. | Este ticket no se puede registrar entrada en este momento. |
| `ticket_not_found` | 404 | `POST /api/tickets/:id/en-route`, `POST /api/tickets/:id/approve`, `POST /api/tickets/:id/disperse-funds`, `POST /api/tickets/:id/accept`, `POST /api/tickets/:id/deny`, `POST /api/tickets/:id/reinvite`, `POST /api/tickets/:id/unlock`, `POST /api/tickets/:id/cancel`, `POST /api/tickets/:id/reactivate`, `POST /api/tickets/:id/reverse-funds-dispersal`, `PATCH /api/tickets/:id`, `POST /api/tickets/:id/schedule`, `GET /api/tickets/:id/schedule`, `GET /api/tickets/:id/crew-tracker`, `GET /api/tickets/:id/schedule.ics`, `POST /api/tickets/:id/awaiting-payment` | Ticket not found. | No se encontró el ticket. |
| `ticket_not_funds_dispersed` | 409 | `POST /api/tickets/:id/reverse-funds-dispersal` | Only a ticket whose funds have been dispersed can be reversed. | Solo se puede revertir un ticket cuyos fondos ya fueron dispersados. |
| `ticket_not_in_progress` | 409 | `POST /api/tickets/:id/awaiting-payment` | This ticket isn't in progress. | Este ticket no está en progreso. |
| `ticket_not_reinvitable` | 409 | `POST /api/tickets/:id/reinvite` | This ticket can no longer be reinvited. | Este ticket ya no puede reinvitarse. |
| `ticket_not_unlockable` | 409 | `POST /api/tickets/:id/unlock` | Only submitted or approved tickets can be unlocked. | Solo los tickets enviados o aprobados se pueden desbloquear. |
| `ticket_state_changed` | 409 | `POST /api/tickets/:id/accept`, `POST /api/tickets/:id/deny`, `POST /api/tickets/:id/reinvite` | Ticket state changed — please refresh and try again. | El estado del ticket cambió — actualiza e inténtalo de nuevo. |
| `unlock_reason_required` | 400 | `POST /api/tickets/:id/unlock` | Please enter a reason for unlocking. | Ingresa una razón para desbloquear. |
| `unlock_reason_too_long` | 400 | `POST /api/tickets/:id/unlock` | Reason must be 500 characters or fewer. | La razón debe tener 500 caracteres o menos. |
| `vendor_already_invited` | 400 | `POST /api/tickets/:id/reinvite` | That vendor is already invited. | Ese proveedor ya está invitado. |
| `vendor_id_required` | 400 | `POST /api/tickets/:id/reinvite` | Please choose a vendor to reinvite. | Selecciona un proveedor para reinvitar. |
| `vendor_no_operating_area` | 400 | `POST /api/tickets/direct-award` | Vendor hasn't published an operating area yet. | El proveedor aún no ha publicado un área de operación. |
| `vendor_not_found` | 404 | `POST /api/tickets/:id/reinvite` | Vendor not found. | No se encontró el proveedor. |
| `vendor_out_of_radius` | 400 | `POST /api/tickets/direct-award` | This vendor's operating area doesn't reach the site. | El área de operación de este proveedor no cubre el sitio. |
| `work_type_not_allowed` | 400 | `POST /api/tickets`, `POST /api/tickets/:id/check-in`, `POST /api/tickets/:id/check-out`, `POST /api/tickets/:id/en-route`, `POST /api/tickets/:id/submit` | Your vendor isn't approved for this work type at this site. Pick a different one. | Tu proveedor no está aprobado para este tipo de trabajo en este sitio. Elige otro. |

## Codes emitted by `artifacts/api-server/src/routes/ticketSchedule.ts`

These are in addition to the schedule-related codes already listed in the
table above (`not_authenticated`, `ticket_not_found`, `invalid_ticket_id`,
`crew_invalid_for_vendor`).

| Code | HTTP | Route(s) | EN message | ES message |
| --- | --- | --- | --- | --- |
| `crew_required` | 400 | `POST /api/tickets/:id/schedule/notify` | Select at least one crew member. | Selecciona al menos un miembro de la cuadrilla. |
| `forbidden_not_scheduler` | 403 | `POST /api/tickets/:id/schedule`, `GET /api/tickets/:id/schedule`, `GET /api/tickets/:id/crew-tracker`, `GET /api/tickets/:id/schedule.ics` | You don't have permission to schedule this ticket. | No tienes permiso para programar este ticket. |
| `foreman_not_in_crew` | 400 | `POST /api/tickets/:id/schedule` | The foreman must be one of the assigned crew members. | El capataz debe ser uno de los miembros del equipo asignados. |
| `invalid_scheduled_duration_minutes` | 400 | `POST /api/tickets/:id/schedule` | Duration must be a positive number of minutes. | La duración debe ser un número positivo de minutos. |
| `not_scheduled` | 409 | `GET /api/tickets/:id/crew-tracker`, `POST /api/tickets/:id/schedule/notify`, `GET /api/tickets/:id/schedule.ics` | This ticket isn't scheduled yet. | Este ticket aún no está programado. |
| `scheduled_start_at_required` | 400 | `POST /api/tickets/:id/schedule` | Please pick a start time. | Selecciona una hora de inicio. |

## Codes emitted by `artifacts/api-server/src/routes/locations.ts`

These are in addition to `site_not_found`, which is already listed in
the `tickets.ts` table above.

| Code | HTTP | Route(s) | EN message | ES message |
| --- | --- | --- | --- | --- |
| `forbidden` | 403 | `GET /api/live-locations`, `GET /api/live-locations/events`, `GET /api/field-employees/:id/day-track`, `GET /api/site-map/:siteLocationId/nearby` | You don't have permission to do that. | No tienes permiso para hacer eso. |
| `invalid_date` | 400 | `GET /api/field-employees/:id/day-track` | That date isn't valid. | Esa fecha no es válida. |
| `invalid_id` | 400 | `GET /api/field-employees/:id/day-track` | That id isn't valid. | Ese ID no es válido. |
| `no_active_consent` | 403 | `POST /api/location-pings` | Location sharing is off for this device. Turn it on to share your location. | El uso compartido de ubicación está desactivado en este dispositivo. Actívalo para compartir tu ubicación. |
| `no_employee_profile` | 403 | `POST /api/location-pings` | We couldn't find your field employee profile. | No encontramos tu perfil de empleado de campo. |
| `no_partner` | 403 | `GET /api/site-map/:siteLocationId/nearby` | This visitor site is not linked to a partner. | Este sitio de visitante no está vinculado a un socio. |
| `no_vendor` | 403 | `GET /api/live-locations`, `GET /api/live-locations/events` | Your account isn't linked to a vendor. | Tu cuenta no está vinculada a un proveedor. |
| `not_found` | 404 | `GET /api/field-employees/:id/day-track` | We couldn't find that record. | No encontramos ese registro. |
| `not_ticket_owner` | 403 | `POST /api/location-pings` | You're not assigned to that ticket. | No estás asignado a ese ticket. |
| `ticket_not_on_shift` | 409 | `POST /api/location-pings` | This ticket isn't on shift right now. | Este ticket no está en turno en este momento. |
| `unauthenticated` | 401 | `GET /api/location-consents/me`, `POST /api/location-consents`, `DELETE /api/location-consents`, `POST /api/location-pings`, `GET /api/live-locations`, `GET /api/live-locations/events`, `GET /api/field-employees/:id/day-track`, `GET /api/site-map/:siteLocationId/nearby` | Please sign in to continue. | Inicia sesión para continuar. |
| `wrong_vendor` | 403 | `GET /api/live-locations`, `GET /api/live-locations/events`, `GET /api/field-employees/:id/day-track` | That doesn't belong to your vendor. | Eso no pertenece a tu proveedor. |

## Codes emitted by `artifacts/api-server/src/routes/hotlist.ts`

| Code | HTTP | Route(s) | EN message | ES message |
| --- | --- | --- | --- | --- |
| `vendor_not_approved` | 403 | `POST /api/hotlist/jobs/:id/bids` | Only approved vendors can bid on hotlist jobs. Reach out to the partner to request approval. | Solo los proveedores aprobados pueden ofertar en trabajos del Hotlist. Contacta al socio para solicitar la aprobación. |

## Codes emitted by `artifacts/api-server/src/routes/field.ts`

All three codes are shared with the office `POST /api/tickets` path
(see the `tickets.ts` table above) and reuse the same `errors.<code>`
locale entries. They're listed again here so the field self-create
flow is documented in one place.

| Code | HTTP | Route(s) | EN message | ES message |
| --- | --- | --- | --- | --- |
| `field_email_required` | 400 | `POST /api/field-employees/:id/login` | Email is required. | El correo es obligatorio. |
| `field_mobile_viewer_login_required` | 401 | `GET /api/field/open-tickets`, `GET /api/field/me` | Sign in with a mobile field account to continue. | Inicia sesión con una cuenta móvil de campo para continuar. |
| `field_partner_not_found` | 403 | `GET /api/field/open-tickets`, `GET /api/field/me` | That partner wasn't found. | No se encontró ese socio. |
| `foreman_required` | 403 | Foreman-only field endpoints | A foreman is required. | Se requiere un capataz. |
| `internal_error` | 500 | `POST /api/field/tickets` | Something went wrong on our end. Please try again. | Algo salió mal de nuestro lado. Inténtalo de nuevo. |
| `site_not_found` | 400 | `POST /api/field/tickets` | We couldn't find that site. Pick a different one. | No encontramos ese sitio. Elige otro. |
| `site_vendor_mismatch` | 400 | `POST /api/field/tickets` | Your vendor isn't assigned to work at this site. Pick a different one. | Tu proveedor no está asignado a trabajar en este sitio. Elige otro. |
| `work_type_not_allowed` | 400 | `POST /api/field/tickets` | Your vendor isn't approved for this work type at this site. Pick a different one. | Tu proveedor no está aprobado para este tipo de trabajo en este sitio. Elige otro. |

## AskV voice session codes

These dotted `code` values from `assistantRealtime.ts` are translated under `errors.assistant` in both web and mobile EN/ES catalogs.

| Code | HTTP | User recovery |
| --- | --- | --- |
| `assistant.idempotency_required` | 400 | Check the record before retrying an action whose identifier is missing. |
| `assistant.session_ended` | 409 | Open AskV to begin another conversation. |
| `assistant.session_required` | 400 | Open AskV to start a voice session. |
| `assistant.tool_not_available` | 403 | Use the permitted screen or ask another question. |
| `assistant.voice_disabled` | 503 | Continue with typed AskV while voice is unavailable for this account. |
