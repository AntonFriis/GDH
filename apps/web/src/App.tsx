import { nextPhaseLabel, operatingArtifacts, phaseZeroCards } from './phase-data';
import './app.css';

export function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Governed Delivery Control Plane</p>
        <h1>Phase 0 bootstrap is in place.</h1>
        <p className="hero-copy">
          This workspace is prepared for a Codex-first governed delivery control plane. The current
          repo focuses on structure, tooling, and operating discipline rather than the execution
          loop itself.
        </p>
        <div className="hero-badge">{nextPhaseLabel}</div>
      </section>

      <section className="grid">
        {phaseZeroCards.map((card) => (
          <article className="card" key={card.title}>
            <h2>{card.title}</h2>
            <p>{card.body}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Codex operating artifacts</h2>
        <ul>
          {operatingArtifacts.map((artifact) => (
            <li key={artifact}>{artifact}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default App;
