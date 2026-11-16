# iPhone overlay dismissal inventory

Source inventory: 2026-11-15. This is a source and browser-preview audit, not a claim of physical iPhone testing.

## Shared contract

Native modal owners use `DismissibleModal`: a 44-point top-right X and a persistent bottom Cancel (editable) or Close (read-only), outside the scrolling body. Both call the existing dismissal handler, never a submit/skip handler. Required company selection exits via Sign out. Existing pending-write guards remain in place and disable the controls until the request settles.

Web Dialog, AlertDialog, Sheet and VendorEditFlyout provide header X and bottom Cancel. Inline dialog frames are not overlays and do not gain these controls. Next Steps provides Close on its panel and active helper. Gate plate-state selection has X and Cancel without selecting a state.

## Reviewed exceptions

- Ticket mileage: Cancel clears the prompt; Skip still performs its existing field transition. They are deliberately separate actions.
- Guided training correction: dismissal preserves the unanswered correction and original response. Review correction reopens it; no completion credit is granted by dismissal.
- Required password change and company selection: exit signs out, preserving the requirement at next login.
- Account-created dialog: X/Cancel returns to the dashboard using the existing dashboard action.
- Pending financial actions and editor writes: dismissal is visibly disabled while the existing operation is pending.
- Read-only photo, result and history previews: Close does not change records.

Additional custom web surfaces: the read-only platform agreement, public product guide, and Work Hub notification detail now include bottom Close. The inline subcontractor revoke confirmation already has Cancel and does not block page navigation.

## Native owners

| Source | Modal count |
|---|---:|
| `artifacts/vndrly-mobile/components/AssistantSendToModal.tsx` | 1 |
| `artifacts/vndrly-mobile/components/CommentsPanel.tsx` | 1 |
| `artifacts/vndrly-mobile/components/ContextPickerModal.tsx` | 1 |
| `artifacts/vndrly-mobile/components/CrewTimeSection.tsx` | 1 |
| `artifacts/vndrly-mobile/components/EmployeeCertificationsPanel.tsx` | 2 |
| `artifacts/vndrly-mobile/components/EquipmentMapPicker.tsx` | 1 |
| `artifacts/vndrly-mobile/components/EquipmentWorkbench.tsx` | 1 |
| `artifacts/vndrly-mobile/components/ErrorFallback.tsx` | 1 |
| `artifacts/vndrly-mobile/components/FleetChoiceField.tsx` | 1 |
| `artifacts/vndrly-mobile/components/FleetDestinationDirectory.tsx` | 1 |
| `artifacts/vndrly-mobile/components/ForemanScheduleTicketsModal.tsx` | 1 |
| `artifacts/vndrly-mobile/components/GateAssumeWatchFlyout.tsx` | 1 |
| `artifacts/vndrly-mobile/components/GateHistory.tsx` | 1 |
| `artifacts/vndrly-mobile/components/GateSiteGateSelect.tsx` | 1 |
| `artifacts/vndrly-mobile/components/MeetingAdmissionLobby.tsx` | 1 |
| `artifacts/vndrly-mobile/components/NotificationActionModal.tsx` | 1 |
| `artifacts/vndrly-mobile/components/NotificationSendToModal.tsx` | 1 |
| `artifacts/vndrly-mobile/components/PartnerSiteCrewMapScreen.tsx` | 1 |
| `artifacts/vndrly-mobile/components/PlateStatePicker.tsx` | 1 |
| `artifacts/vndrly-mobile/components/ScheduleTicketPanel.tsx` | 1 |
| `artifacts/vndrly-mobile/components/SetCrewModal.tsx` | 1 |
| `artifacts/vndrly-mobile/components/WorkHubCallPolicy.tsx` | 1 |
| `artifacts/vndrly-mobile/components/WorkHubCalls.tsx` | 2 |
| `artifacts/vndrly-mobile/components/WorkHubChatInbox.tsx` | 1 |
| `artifacts/vndrly-mobile/components/WorkHubLiveMeetings.tsx` | 1 |
| `artifacts/vndrly-mobile/components/WorkHubMeetings.tsx` | 1 |
| `artifacts/vndrly-mobile/components/gate/GateAppShell.tsx` | 1 |
| `artifacts/vndrly-mobile/components/profile/GateLocationsCard.tsx` | 1 |
| `artifacts/vndrly-mobile/components/work-hub/FormCampaignEditor.tsx` | 1 |
| `artifacts/vndrly-mobile/components/work-hub/TaskAssignment.tsx` | 1 |
| `artifacts/vndrly-mobile/components/work-hub/library/OnboardingNotice.tsx` | 1 |
| `artifacts/vndrly-mobile/app/(tabs)/askv.tsx` | 1 |
| `artifacts/vndrly-mobile/app/ticket/[id].tsx` | 7 |

Total: 41 modal declarations across 33 owners.

## Verification boundary

Focused component tests cover explicit dismissal, pending-operation guards, required-account labels, correction dismissal/reopen and state-picker cancellation. Phone-sized browser previews cover portrait, landscape and shortened viewports. Native keyboard animation, native sheet gestures and hardware safe areas still require a physical-device pass. No business records are changed by these checks.
