import "./commands";

// Known app issue (reported in docs/tasks/T002.md): React hydration mismatch #418 on first load of /login in
// Cypress's Chrome. It does not block any flow, so it must not fail unrelated specs. Remove once fixed.
Cypress.on("uncaught:exception", (err) => !/Minified React error #418\b/.test(err.message));
