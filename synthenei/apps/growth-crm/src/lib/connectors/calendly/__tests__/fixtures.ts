// Bodies in the vendors' published shapes (trimmed). Emails and names are obviously fake.
export const START = "2030-03-04T05:30:00.000000Z", END = "2030-03-04T06:00:00.000000Z";
const inv = (over: Record<string, unknown> = {}) => ({
  uri: "https://api.calendly.com/scheduled_events/EV1/invitees/INV1", email: "Pat.Example@Example.test", name: "Pat Example", status: "active", rescheduled: false, old_invitee: null, new_invitee: null,
  scheduled_event: { uri: "https://api.calendly.com/scheduled_events/EV1", name: "Intro call", start_time: START, end_time: END, status: "active" },
  ...over,
});
export const calendlyCreated = (over: Record<string, unknown> = {}) => JSON.stringify({ event: "invitee.created", created_at: "2030-03-01T00:00:00.000000Z", payload: inv(over) });
export const calendlyCanceled = (over: Record<string, unknown> = {}) => JSON.stringify({ event: "invitee.canceled", created_at: "2030-03-02T00:00:00.000000Z", payload: inv({ status: "canceled", cancellation: { canceled_by: "Pat", reason: "Clash" }, ...over }) });

const cal = (trigger: string, over: Record<string, unknown> = {}) => JSON.stringify({
  triggerEvent: trigger, createdAt: "2030-03-01T00:00:00.000Z",
  payload: { title: "Intro call", startTime: "2030-03-04T05:30:00.000Z", endTime: "2030-03-04T06:00:00.000Z", uid: "calUID1", attendees: [{ email: "Pat.Example@Example.test", name: "Pat Example", timeZone: "Asia/Kolkata" }], ...over },
});
export const calCreated = (over: Record<string, unknown> = {}) => cal("BOOKING_CREATED", over);
export const calCancelled = (over: Record<string, unknown> = {}) => cal("BOOKING_CANCELLED", { cancellationReason: "Clash", ...over });
export const calRescheduled = (over: Record<string, unknown> = {}) => cal("BOOKING_RESCHEDULED", { uid: "calUID2", rescheduleUid: "calUID1", ...over });
