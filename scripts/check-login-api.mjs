// Quick HTTPS smoke test for login API
const r = await fetch("https://vndrly.ai/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "test@test.com", password: "wrong" }),
});
console.log("login status", r.status, await r.text());
