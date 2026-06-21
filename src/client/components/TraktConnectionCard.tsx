import { CheckCircle2, ExternalLink, Loader2, LogOut, Tv } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TraktStatus } from "../../shared/types";
import { api } from "../lib/api";

interface TraktConnectionCardProps {
  onConnectedChange?: (connected: boolean) => void;
}

export function TraktConnectionCard({ onConnectedChange }: TraktConnectionCardProps) {
  const [status, setStatus] = useState<TraktStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lastConnected = useRef<boolean | null>(null);

  function applyStatus(next: TraktStatus) {
    setStatus(next);
    if (lastConnected.current !== next.connected) {
      lastConnected.current = next.connected;
      onConnectedChange?.(next.connected);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void api
      .traktStatus()
      .then((next) => {
        if (!cancelled) applyStatus(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // While a device authorization is pending, poll status until the user enters the code.
  useEffect(() => {
    if (!status?.pending) return;
    const timer = window.setInterval(() => {
      void api
        .traktStatus()
        .then(applyStatus)
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [status?.pending]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      applyStatus(await api.traktConnect());
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not start Trakt authorization.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      applyStatus(await api.traktDisconnect());
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect Trakt.");
    } finally {
      setBusy(false);
    }
  }

  // Hide the card entirely when the server has no Trakt credentials configured.
  if (status && !status.configured) {
    return (
      <div className="connection-card">
        <div className="connection-title">
          <div>
            <h3>Trakt</h3>
            <p>Compare your Trakt watchlist against your library.</p>
          </div>
        </div>
        <p className="muted-line">
          Trakt isn’t configured on this server. Set <code>TRAKT_CLIENT_ID</code> and <code>TRAKT_CLIENT_SECRET</code> in the
          server environment to enable it.
        </p>
      </div>
    );
  }

  return (
    <div className="connection-card">
      <div className="connection-title">
        <div>
          <h3>Trakt</h3>
          <p>Connect your Trakt account to browse your watchlist as a search source.</p>
        </div>
        {status?.connected ? (
          <button className="ghost-button trakt-connect-button" onClick={disconnect} disabled={busy}>
            <LogOut size={17} />
            Disconnect
          </button>
        ) : (
          <button className="ghost-button trakt-connect-button" onClick={connect} disabled={busy || status?.pending}>
            {busy ? <Loader2 size={17} className="spin" /> : <Tv size={17} />}
            Connect Trakt
          </button>
        )}
      </div>

      {status?.connected ? (
        <p className="connection-result ok">
          <CheckCircle2 size={16} />
          Connected as {status.username ?? "your Trakt account"}.
        </p>
      ) : null}

      {status?.pending ? (
        <div className="trakt-pending">
          <p className="muted-line">
            Go to{" "}
            <a href={status.verificationUrl ?? "https://trakt.tv/activate"} target="_blank" rel="noopener noreferrer">
              {(status.verificationUrl ?? "https://trakt.tv/activate").replace(/^https?:\/\//, "")}
              <ExternalLink size={13} />
            </a>{" "}
            and enter this code:
          </p>
          <div className="trakt-code">{status.userCode}</div>
          <p className="status-line">
            <Loader2 size={15} className="spin" />
            Waiting for authorization…
          </p>
        </div>
      ) : null}

      {!status?.connected && !status?.pending && status?.message ? <p className="error-line">{status.message}</p> : null}
      {error ? <p className="error-line">{error}</p> : null}
    </div>
  );
}
