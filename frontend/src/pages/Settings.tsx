import { useState } from 'react';
import { useSettings } from '../store/settings';
import { apiFetch } from '../api/client';
import type { HealthResponse } from '../api/types';

export default function Settings() {
  const settings = useSettings();
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [backend, setBackend] = useState(settings.backendOverride);
  const [show, setShow] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const save = () => {
    settings.setApiKey(apiKey.trim());
    settings.setBackendOverride(backend.trim());
    setTestResult(null);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    // Apply the pending values first so apiFetch uses them.
    settings.setApiKey(apiKey.trim());
    settings.setBackendOverride(backend.trim());
    try {
      const res = await apiFetch<HealthResponse>('/api/health');
      setTestResult(
        res.ok
          ? `Connected · ${res.service} v${res.version} · db=${res.dependencies.database}, redis=${res.dependencies.redis}`
          : 'Backend reached but unhealthy',
      );
    } catch (err) {
      setTestResult(`Failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid gap-6 max-w-2xl">
      <section className="panel-padded grid gap-4">
        <h2 className="label m-0">Backend connection</h2>

        <div>
          <label className="label">Backend URL</label>
          <input
            className="input"
            placeholder="https://noc.example.com (blank = same origin)"
            value={backend}
            onChange={(e) => setBackend(e.target.value)}
          />
        </div>

        <div>
          <label className="label">API key</label>
          <div className="flex gap-2">
            <input
              className="input"
              type={show ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="One of the FRONTEND_API_KEYS values"
            />
            <button type="button" className="btn" onClick={() => setShow(!show)}>
              {show ? 'hide' : 'show'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn" onClick={save}>Save</button>
          <button className="btn" onClick={testConnection} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span
              className={`text-sm mono ${
                testResult.startsWith('Connected')
                  ? 'text-noc-accent'
                  : 'text-noc-critical'
              }`}
            >
              {testResult}
            </span>
          )}
        </div>
      </section>

      <section className="panel-padded grid gap-2">
        <h2 className="label m-0">About</h2>
        <div className="text-sm text-noc-text-dim">
          Dashboard v0.1.0. Alert engine and detail charts land in Commit C.
        </div>
      </section>
    </div>
  );
}
