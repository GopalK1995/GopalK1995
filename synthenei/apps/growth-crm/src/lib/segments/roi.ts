// Campaign cost maths in INR. Money is held in paise internally so sums never drift; results are rupees rounded to 2 places.
// Division by zero gives null (the UI prints a dash), never Infinity or NaN.
const paise = (inr: number) => Math.round(inr * 100);
const rupees = (p: number) => Math.round(p) / 100;

export const sumSpend = (days: { spend: number }[]) => rupees(days.reduce((a, d) => a + paise(d.spend), 0));
export const costPer = (spendInr: number, count: number): number | null => (count > 0 && Number.isFinite(spendInr) ? rupees(paise(spendInr) / count) : null);
export const cpl = costPer;
/** (revenue - spend) / spend as a fraction; null when nothing was spent. */
export const roi = (revenueInr: number, spendInr: number): number | null => (spendInr > 0 ? Math.round(((paise(revenueInr) - paise(spendInr)) / paise(spendInr)) * 10000) / 10000 : null);
export const roas = (revenueInr: number, spendInr: number): number | null => (spendInr > 0 ? Math.round((paise(revenueInr) / paise(spendInr)) * 100) / 100 : null);
export const budgetUsed = (spendInr: number, budgetInr: number | null): number | null => (budgetInr && budgetInr > 0 ? Math.round((spendInr / budgetInr) * 1000) / 1000 : null);
