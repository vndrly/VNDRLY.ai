import { useState } from "react";
import { login } from "../lib/api";

interface LoginViewProps {
  onLoggedIn: (sessionCookie: string) => void;
}

export function LoginView({ onLoggedIn }: LoginViewProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(username.trim(), password);
      onLoggedIn(result.cookie);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-shell" onSubmit={handleSubmit}>
      <div className="brand">Majik</div>
      <p className="muted">Sign in with your VNDRLY account.</p>
      <input
        autoFocus
        placeholder="Email or username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error ? <div className="error-text">{error}</div> : null}
      <button className="primary-btn" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
