import "./commands";

// Known app issue (reported in docs/tasks/T002.md): React hydration mismatch #418 on first load of /login in
// Cypress's Chrome. It does not block any flow, so it must not fail unrelated specs. Remove once fixed.
// `next dev` prints the full unminified message instead of the prod "#418" string (root layout's manual <head> +
// inline boot script collides with Next's own head management on client hydration — see docs/tasks/T058.md).
// Match both forms so specs run the same way under `next dev` and production.
Cypress.on("uncaught:exception", (err) => !/Minified React error #418\b/.test(err.message) && !/Hydration failed because the server rendered HTML didn't match the client/.test(err.message));
// Next streaming-SSR helper ($RS/$RC) throws "reading 'parentNode'" when Cypress navigates away mid-stream (cy.session setup on /login).
// It is a framework race on a torn-down document, not an app flow failure.
Cypress.on("uncaught:exception", (err) => !/Cannot read properties of null \(reading 'parentNode'\)/.test(err.message));
