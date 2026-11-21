// Zoho CRM v6 response fixtures. They follow Zoho's published response shapes with synthetic ids and people (example.com / .invalid);
// none is a capture from a live Zoho org. Verify against a real developer org before relying on field-level details.
export const COQL_LEADS = {
  data: [
    { id: "1000000000001", Modified_Time: "2026-11-02T10:00:00+05:30", First_Name: "Asha", Last_Name: "Rao", Email: "Asha@Example.com", Phone: "98765 43210", Company: "Rao & Co", Designation: "Partner", City: "Chennai" },
    { id: "1000000000002", Modified_Time: "2026-11-02T10:05:00+05:30", First_Name: null, Last_Name: "Iyer", Email: "iyer@example.com", Phone: null, Company: null, Designation: null, City: null },
  ],
  info: { count: 2, more_records: false },
};
export const COQL_DEALS = {
  data: [{ id: "2000000000001", Modified_Time: "2026-11-03T09:00:00+05:30", Deal_Name: "Plan, 12 seats", Stage: "Proposal/Price Quote", Amount: 12000, Closing_Date: "2026-12-31", Account_Name: { id: "3000000000001", name: "Rao & Co" }, Contact_Name: { id: "4000000000001", name: "Asha Rao" }, Next_Step: "Send quote" }],
  info: { count: 1, more_records: false },
};
export const ORG = { org: [{ id: "9000000000001", company_name: "Example Org" }] };
export const WRITE_OK = { data: [{ code: "SUCCESS", status: "success", message: "record added", details: { id: "1000000000099", Modified_Time: "2026-11-04T10:00:00+05:30" } }] };
export const WRITE_DUPLICATE = { data: [{ code: "DUPLICATE_DATA", status: "error", message: "duplicate data", details: { api_name: "Email", duplicate_record: { id: "1000000000001" } } }] };
export const WRITE_INVALID = { data: [{ code: "INVALID_DATA", status: "error", message: "bad value for Email", details: { api_name: "Email" } }] };

export const WATCH_OK = { watch: [{ code: "SUCCESS", status: "success", details: { events: [{ channel_expiry: "2026-11-10T00:00:00+00:00" }] } }] };
export const notification = (over: Record<string, unknown> = {}) => JSON.stringify({ server_time: "2026-11-04T10:00:00+05:30", query_params: {}, module: "Leads", resource_uri: "https://www.zohoapis.in/crm/v6/Leads", ids: ["1000000000001"], operation: "update", channel_id: "1000001", token: "shared-token", ...over });
