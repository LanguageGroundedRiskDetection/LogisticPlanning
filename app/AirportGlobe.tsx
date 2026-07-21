"use client";

import { FormEvent, useMemo, useState } from "react";
import sourceAirports from "../database/airports.json";

type Airport = (typeof sourceAirports)[number];
type Message = { role: "assistant" | "user"; text: string; proposal?: { code: string; field: keyof Airport; value: unknown } };

const COLORS: Record<string, string> = { "C-5": "#ffb84d", "C-17": "#55d8ff", "C-130": "#98f5bf", None: "#7f8b9b" };
const CAP_FIELDS: (keyof Airport)[] = ["maintenance_capabilities", "refueling_capabilities", "material_handling", "additives"];
const LABELS: Record<string, string> = { maintenance_capabilities: "Maintenance", refueling_capabilities: "Refueling", material_handling: "Material handling", additives: "Fuel additives" };

function normalize(a: Airport): Airport {
  return { ...a, parking: a.parking ?? 0, country: a.country === "Phillipines" ? "Philippines" : a.country === "South Korea" ? "Korea (South)" : a.country };
}

function coordinates(a: Airport, rotation: number) {
  if (a.latitude == null || a.longitude == null) return null;
  const lat = a.latitude * Math.PI / 180;
  const lon = (a.longitude - rotation) * Math.PI / 180;
  const x = Math.cos(lat) * Math.sin(lon);
  const y = -Math.sin(lat);
  const z = Math.cos(lat) * Math.cos(lon);
  return { left: 50 + x * 47, top: 50 + y * 47, visible: z > -0.08, scale: .72 + Math.max(z, 0) * .35 };
}

function Icon({ children }: { children: React.ReactNode }) { return <span className="icon">{children}</span>; }

export default function AirportGlobe() {
  const [airports, setAirports] = useState<Airport[]>(() => sourceAirports.map(normalize));
  const [selected, setSelected] = useState<string | null>("RJTY");
  const [hovered, setHovered] = useState<string | null>(null);
  const [rotation, setRotation] = useState(130);
  const [aircraft, setAircraft] = useState("All aircraft");
  const [query, setQuery] = useState("");
  const [chat, setChat] = useState<Message[]>([{ role: "assistant", text: "Good evening. I can compare airfields or prepare session-only database changes. Try “show C-17 airports with refueling” or “set RJTY parking to 5”." }]);
  const [chatOpen, setChatOpen] = useState(true);
  const [input, setInput] = useState("");
  const [changes, setChanges] = useState(0);

  const visible = useMemo(() => airports.filter(a => {
    const q = query.toLowerCase();
    const matches = !q || a.name.toLowerCase().includes(q) || a.ycao.toLowerCase().includes(q) || a.country.toLowerCase().includes(q);
    const rank: Record<string, number> = { "C-130": 1, "C-17": 2, "C-5": 3 };
    return matches && (aircraft === "All aircraft" || (rank[a.runway_capability] || 0) >= (rank[aircraft] || 0));
  }), [airports, aircraft, query]);
  const active = airports.find(a => a.ycao === selected);
  const hover = airports.find(a => a.ycao === hovered);

  function respond(raw: string) {
    const text = raw.trim();
    if (!text) return;
    const next: Message[] = [...chat, { role: "user", text }];
    const change = text.match(/(?:set|change|update)\s+([A-Za-z0-9]{4})\s+(parking|max[_ ]?working|runways?|refueling|maintenance)\s+(?:to\s+)?(true|false|\d+)/i);
    if (change) {
      const code = change[1].toUpperCase();
      const airport = airports.find(a => a.ycao === code);
      const map: Record<string, keyof Airport> = { parking: "parking", maxworking: "max_working", max_working: "max_working", runway: "number_of_runways", runways: "number_of_runways", refueling: "refueling_capabilities", maintenance: "maintenance_capabilities" };
      const key = change[2].toLowerCase().replace(" ", "_");
      const field = map[key];
      if (airport && field) {
        const value = change[3] === "true" ? true : change[3] === "false" ? false : Number(change[3]);
        next.push({ role: "assistant", text: `Review change · ${airport.name} (${code})\n${LABELS[field] || field.replaceAll("_", " ")}: ${String(airport[field] ?? "unknown")} → ${String(value)}\nThis change lasts only for this browser session.`, proposal: { code, field, value } });
      } else next.push({ role: "assistant", text: `I couldn’t find airfield ${code}. No data was changed.` });
    } else {
      const wantsRefuel = /refuel/i.test(text);
      const cap = text.match(/C-?(5|17|130)/i)?.[0].toUpperCase().replace("C", "C-");
      const rank: Record<string, number> = { "C-130": 1, "C-17": 2, "C-5": 3 };
      const found = airports.filter(a => (!wantsRefuel || a.refueling_capabilities === true) && (!cap || (rank[a.runway_capability] || 0) >= rank[cap])).slice(0, 8);
      next.push({ role: "assistant", text: found.length ? `${found.length}${found.length === 8 ? "+" : ""} matching airfields: ${found.map(a => `${a.name} (${a.ycao})`).join(", ")}.` : "I didn’t find any matching airfields in the current session data." });
    }
    setChat(next); setInput("");
  }

  function applyChange(p: NonNullable<Message["proposal"]>) {
    setAirports(items => items.map(a => a.ycao === p.code ? { ...a, [p.field]: p.value } as Airport : a));
    setChanges(c => c + 1); setSelected(p.code);
    setChat(items => [...items, { role: "assistant", text: `Applied. ${p.code} is updated everywhere on the globe for this session.` }]);
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">A</div><div><b>Airlift Atlas</b><span>INDO–PACIFIC COMMAND</span></div></div>
      <label className="search"><Icon>⌕</Icon><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search airfield, ICAO or country" /><kbd>⌘ K</kbd></label>
      <div className="top-actions"><span className="live"><i /> LIVE DATA</span><button className="avatar" aria-label="User profile">YY</button></div>
    </header>

    <section className="workspace">
      <aside className="rail">
        <button className="rail-btn active" aria-label="Globe">◉</button><button className="rail-btn" aria-label="Routes">⌁</button><button className="rail-btn" aria-label="Airfields">⌖</button>
        <span className="rail-line" />
        <button className="rail-btn" aria-label="Layers">▱</button><button className="rail-btn" aria-label="Settings">⚙</button>
        <button className="rail-btn help" aria-label="Help">?</button>
      </aside>

      <div className="map-stage">
        <div className="map-heading"><div><span className="eyebrow">OPERATIONS OVERVIEW</span><h1>Pacific Air Mobility</h1><p>{visible.length} airfields online · Session data</p></div>
          <button className="session-pill"><i /> {changes ? `${changes} SESSION CHANGE${changes > 1 ? "S" : ""}` : "ORIGINAL DATA"}</button>
        </div>
        <div className="globe-wrap">
          <div className="orbit one"/><div className="orbit two"/>
          <div className="globe" style={{ backgroundPositionX: `${rotation * 2.1}px` }}>
            <div className="globe-shade" />
            {visible.map(a => { const p = coordinates(a, rotation); if (!p?.visible) return null; return <button key={a.ycao} className={`marker ${a.hub_spoke === "H" ? "hub" : ""} ${selected === a.ycao ? "selected" : ""}`} style={{ left: `${p.left}%`, top: `${p.top}%`, transform: `translate(-50%,-50%) scale(${p.scale})`, "--marker": COLORS[a.runway_capability] } as React.CSSProperties} onMouseEnter={() => setHovered(a.ycao)} onMouseLeave={() => setHovered(null)} onClick={() => setSelected(a.ycao)} aria-label={a.name}><span/><em>{a.ycao}</em></button> })}
            {hover && coordinates(hover, rotation)?.visible && <div className="hover-card" style={{ left: `${coordinates(hover, rotation)!.left}%`, top: `${coordinates(hover, rotation)!.top}%` }}><div className="hover-top"><b>{hover.name}</b><span>{hover.ycao}</span></div><p>{hover.country} · {hover.hub_spoke === "H" ? "Hub" : "Spoke"}</p><div className="hover-stats"><span><small>AIRCRAFT</small>{hover.runway_capability}</span><span><small>WORKING</small>{hover.max_working ?? "—"}</span><span><small>PARKED</small>{hover.parking ?? 0}</span></div></div>}
          </div>
        </div>
        <div className="globe-controls"><button onClick={() => setRotation(r => r - 12)}>‹</button><button onClick={() => setRotation(130)} title="Reset globe">◎</button><button onClick={() => setRotation(r => r + 12)}>›</button></div>
        <div className="filter-bar"><div className="select-wrap"><span>AIRCRAFT COMPATIBILITY</span><select value={aircraft} onChange={e => setAircraft(e.target.value)}><option>All aircraft</option><option>C-130</option><option>C-17</option><option>C-5</option></select></div><div className="legend"><span><i className="dot c5"/>C-5</span><span><i className="dot c17"/>C-17</span><span><i className="dot c130"/>C-130</span><span className="divider"/><span><i className="hub-shape"/>Hub</span><span><i className="spoke-shape"/>Spoke</span></div></div>
      </div>

      {active && <aside className="detail-panel">
        <button className="close" onClick={() => setSelected(null)}>×</button><span className="eyebrow">AIRFIELD PROFILE</span><div className="detail-title"><div><h2>{active.name}</h2><p>{active.country}</p></div><b>{active.ycao}</b></div>
        <div className="role-row"><span className="role">{active.hub_spoke === "H" ? "◆ HUB" : "● SPOKE"}</span>{active.usage && <span>{active.usage === "Mil" ? "MILITARY" : active.usage === "Civ" ? "CIVIL" : "JOINT USE"}</span>}<span className="status">OPERATIONAL</span></div>
        <section className="capacity"><h3>Capacity at a glance</h3><div className="capacity-grid"><div><Icon>✈</Icon><span><b>{active.runway_capability}</b><small>MAX AIRCRAFT</small></span></div><div><Icon>↔</Icon><span><b>{active.max_working ?? "—"}</b><small>MAX WORKING</small></span></div><div><Icon>▦</Icon><span><b>{active.parking ?? 0}</b><small>CURRENT PARKED</small></span></div><div><Icon>━</Icon><span><b>{active.number_of_runways}</b><small>RUNWAYS</small></span></div></div></section>
        <section><h3>Ground capabilities</h3><div className="capabilities">{CAP_FIELDS.map(field => active[field] == null ? null : <div key={field}><span className={active[field] ? "yes" : "no"}>{active[field] ? "✓" : "×"}</span><b>{LABELS[field]}</b><small>{active[field] ? "AVAILABLE" : "NOT AVAILABLE"}</small></div>)}</div></section>
        <section><h3>Location</h3><div className="location"><span>LATITUDE<b>{active.latitude == null ? "—" : `${Math.abs(active.latitude).toFixed(2)}° ${active.latitude >= 0 ? "N" : "S"}`}</b></span><span>LONGITUDE<b>{active.longitude == null ? "—" : `${Math.abs(active.longitude).toFixed(2)}° ${active.longitude >= 0 ? "E" : "W"}`}</b></span></div></section>
        <button className="ask" onClick={() => { setChatOpen(true); setInput(`Tell me about ${active.ycao}`); }}>✦ Ask Atlas about this airfield</button>
      </aside>}
    </section>

    <section className={`chat-panel ${chatOpen ? "open" : ""}`}>
      <button className="chat-toggle" onClick={() => setChatOpen(!chatOpen)}><span>✦</span><b>Atlas Assistant</b><i>{chatOpen ? "×" : "↑"}</i></button>
      {chatOpen && <><div className="chat-head"><div><span className="ai-glyph">✦</span><div><b>Atlas Assistant</b><small><i/> AIRFIELD INTELLIGENCE</small></div></div><button onClick={() => setChatOpen(false)}>—</button></div><div className="messages">{chat.map((m, i) => <div key={i} className={`message ${m.role}`}><span>{m.role === "assistant" ? "✦" : "YY"}</span><div><p>{m.text}</p>{m.proposal && <button onClick={() => applyChange(m.proposal!)}>Apply session change</button>}</div></div>)}</div><form className="chat-input" onSubmit={(e: FormEvent) => { e.preventDefault(); respond(input); }}><input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask or modify session data…"/><button>↑</button></form><p className="privacy">Session edits are cleared when you close this page.</p></>}
    </section>
  </main>;
}
