"use client";

import dynamic from "next/dynamic";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import sourceAirports from "../database/airports.json";
import "./globe.css";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

type Airport = (typeof sourceAirports)[number] & {
  operational_status?: "operational" | "temporarily_unavailable";
  status_reason?: string;
  status_confidence?: number;
  status_updated_at?: string;
};
type Proposal = { code: string; patch: Partial<Airport>; summary: string };
type Message = { role: "assistant" | "user"; text: string; confidence?: number; proposal?: Proposal; imageName?: string };
type Assessment = { action: "disable_airport" | "reopen_airport" | "none" | "clarify"; confidence: number; hazard: string; evidence: string[]; clarification: string; summary: string; model: string; airportCode: string };

const COLORS: Record<string, string> = { "C-5": "#ffb84d", "C-17": "#55d8ff", "C-130": "#98f5bf", None: "#7f8b9b" };
const CAP_FIELDS: (keyof Airport)[] = ["maintenance_capabilities", "refueling_capabilities", "material_handling", "additives"];
const LABELS: Record<string, string> = { maintenance_capabilities: "Maintenance", refueling_capabilities: "Refueling", material_handling: "Material handling", additives: "Fuel additives" };

function normalize(a: Airport): Airport {
  return { ...a, parking: a.parking ?? 0, operational_status: "operational", country: a.country === "Phillipines" ? "Philippines" : a.country === "South Korea" ? "Korea (South)" : a.country };
}

function Icon({ children }: { children: React.ReactNode }) { return <span className="icon">{children}</span>; }

function GlobeMap({ airports, selected, onSelect, onHover }: { airports: Airport[]; selected: string | null; onSelect: (code: string) => void; onHover: (code: string | null) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const globe = useRef<any>(null);
  const [size, setSize] = useState(650);
  const points = useMemo(() => airports.filter(a => a.latitude != null && a.longitude != null).map(a => ({ ...a, lat: a.latitude!, lng: a.longitude! })), [airports]);

  useEffect(() => {
    if (!wrap.current) return;
    const observer = new ResizeObserver(([entry]) => setSize(Math.max(360, Math.min(entry.contentRect.width, entry.contentRect.height))));
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      globe.current?.pointOfView({ lat: 18, lng: 135, altitude: 1.75 }, 700);
      const controls = globe.current?.controls();
      if (controls) { controls.enableDamping = true; controls.dampingFactor = .08; controls.autoRotate = false; }
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  function tooltip(raw: object) {
    const a = raw as Airport;
    const warning = a.operational_status === "temporarily_unavailable" ? `<aside>⚠ TEMPORARILY UNAVAILABLE · ${a.status_reason || "Session update"}</aside>` : "";
    return `<div class="globe-tooltip"><div><b>${a.name}</b><em>${a.ycao}</em></div><p>${a.country} · ${a.hub_spoke === "H" ? "Hub" : "Spoke"}</p>${warning}<section><span><small>AIRCRAFT</small>${a.runway_capability}</span><span><small>MAX WORKING</small>${a.max_working ?? "—"}</span><span><small>PARKED</small>${a.parking ?? 0}</span></section><footer>Click for full airfield profile</footer></div>`;
  }

  return <div className="true-globe" ref={wrap}>
    <Globe ref={globe} width={size} height={size} backgroundColor="rgba(0,0,0,0)" globeImageUrl="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg" bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png" atmosphereColor="#6edbd6" atmosphereAltitude={.16} pointsData={points} pointLat="lat" pointLng="lng" pointAltitude={(p: object) => (p as Airport).ycao === selected ? .055 : .025} pointRadius={(p: object) => (p as Airport).hub_spoke === "H" ? .24 : .17} pointColor={(p: object) => (p as Airport).operational_status === "temporarily_unavailable" ? "#ff4e68" : COLORS[(p as Airport).runway_capability]} pointLabel={tooltip} onPointHover={(p: object | null) => onHover(p ? (p as Airport).ycao : null)} onPointClick={(p: object) => onSelect((p as Airport).ycao)} ringsData={points.filter(a => a.hub_spoke === "H" || a.ycao === selected || a.operational_status === "temporarily_unavailable")} ringLat="lat" ringLng="lng" ringColor={(p: object) => (p as Airport).operational_status === "temporarily_unavailable" ? ["rgba(255,78,104,.8)", "rgba(255,78,104,0)"] : ["rgba(99,220,213,.75)", "rgba(99,220,213,0)"]} ringMaxRadius={1.1} ringPropagationSpeed={.8} ringRepeatPeriod={1700} />
  </div>;
}

export default function AirportGlobe() {
  const [airports, setAirports] = useState<Airport[]>(() => sourceAirports.map(normalize));
  const [selected, setSelected] = useState<string | null>("RJTY");
  const [hovered, setHovered] = useState<string | null>(null);
  const [aircraft, setAircraft] = useState("All aircraft");
  const [query, setQuery] = useState("");
  const [chat, setChat] = useState<Message[]>([{ role: "assistant", text: "Good evening. I can compare airfields or prepare session-only database changes. Try “show C-17 airports with refueling” or “set RJTY parking to 5”." }]);
  const [chatOpen, setChatOpen] = useState(true);
  const [input, setInput] = useState("");
  const [changes, setChanges] = useState(0);
  const [currentAirport, setCurrentAirport] = useState("RJTY");
  const [model, setModel] = useState("gpt-5.4-mini");
  const [image, setImage] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => airports.filter(a => {
    const q = query.toLowerCase();
    const matches = !q || a.name.toLowerCase().includes(q) || a.ycao.toLowerCase().includes(q) || a.country.toLowerCase().includes(q);
    const rank: Record<string, number> = { "C-130": 1, "C-17": 2, "C-5": 3 };
    return matches && (aircraft === "All aircraft" || (rank[a.runway_capability] || 0) >= (rank[aircraft] || 0));
  }), [airports, aircraft, query]);
  const active = airports.find(a => a.ycao === selected);

  async function respond(raw: string) {
    const text = raw.trim();
    if (!text && !image) return;
    if (image) {
      await analyzeImage(text || "Assess this image for current airfield operating hazards.");
      return;
    }
    const next: Message[] = [...chat, { role: "user", text, confidence: 1 }];
    const change = text.match(/(?:set|change|update)\s+([A-Za-z0-9]{4})\s+(parking|max[_ ]?working|runways?|refueling|maintenance)\s+(?:to\s+)?(true|false|\d+)/i);
    if (change) {
      const code = change[1].toUpperCase();
      const airport = airports.find(a => a.ycao === code);
      const map: Record<string, keyof Airport> = { parking: "parking", maxworking: "max_working", max_working: "max_working", runway: "number_of_runways", runways: "number_of_runways", refueling: "refueling_capabilities", maintenance: "maintenance_capabilities" };
      const key = change[2].toLowerCase().replace(" ", "_");
      const field = map[key];
      if (airport && field) {
        const value = change[3] === "true" ? true : change[3] === "false" ? false : Number(change[3]);
        const confidence = 0.98;
        const proposal = { code, patch: { [field]: value } as Partial<Airport>, summary: `${LABELS[field] || field.replaceAll("_", " ")}: ${String(airport[field] ?? "unknown")} → ${String(value)}` };
        next.push({ role: "assistant", confidence, text: `Request understood · ${airport.name} (${code})\n${proposal.summary}\nConfidence is above 0.85, so the session change was applied automatically.` });
        setAirports(items => items.map(a => a.ycao === code ? { ...a, ...proposal.patch } : a));
        setChanges(c => c + 1); setSelected(code);
      } else next.push({ role: "assistant", text: `I couldn’t find airfield ${code}. No data was changed.` });
    } else {
      const wantsRefuel = /refuel/i.test(text);
      const cap = text.match(/C-?(5|17|130)/i)?.[0].toUpperCase().replace("C", "C-");
      const rank: Record<string, number> = { "C-130": 1, "C-17": 2, "C-5": 3 };
      const found = airports.filter(a => (!wantsRefuel || a.refueling_capabilities === true) && (!cap || (rank[a.runway_capability] || 0) >= rank[cap])).slice(0, 8);
      const confidence = wantsRefuel || cap ? .93 : .48;
      next.push({ role: "assistant", confidence, text: confidence > .85 ? (found.length ? `${found.length}${found.length === 8 ? "+" : ""} matching airfields: ${found.map(a => `${a.name} (${a.ycao})`).join(", ")}.` : "I didn’t find any matching airfields in the current session data.") : `I’m not confident I understood the request. Are you asking about ${airports.find(a => a.ycao === currentAirport)?.name || "your current airport"}, or should I search all airfields?` });
    }
    setChat(next); setInput("");
  }

  function applyChange(p: NonNullable<Message["proposal"]>) {
    setAirports(items => items.map(a => a.ycao === p.code ? { ...a, ...p.patch } : a));
    setChanges(c => c + 1); setSelected(p.code);
    setChat(items => [...items, { role: "assistant", text: `Applied. ${p.code} is updated everywhere on the globe for this session.` }]);
  }

  async function analyzeImage(text: string) {
    const airport = airports.find(a => a.ycao === currentAirport);
    if (!airport || !image) return;
    const uploaded = image;
    setChat(items => [...items, { role: "user", text, imageName: uploaded.name, confidence: 1 }]);
    setAnalyzing(true);
    try {
      const form = new FormData();
      form.append("image", uploaded);
      form.append("airportCode", airport.ycao);
      form.append("airportName", airport.name);
      form.append("message", text);
      form.append("model", model);
      form.append("apiKey", apiKey);
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      const result = await response.json() as Assessment & { error?: string };
      if (!response.ok) throw new Error(result.error || "Image analysis failed.");
      const confidence = Math.max(0, Math.min(1, result.confidence));
      const evidence = result.evidence.length ? `\nVisible evidence: ${result.evidence.join("; ")}` : "";
      if (result.action === "clarify" || confidence < .6) {
        setChat(items => [...items, { role: "assistant", confidence, text: `${result.summary}${evidence}\n${result.clarification || "Can you clarify when and where this image was captured?"}` }]);
      } else if (result.action === "disable_airport" || result.action === "reopen_airport") {
        const disabling = result.action === "disable_airport";
        const proposal: Proposal = { code: airport.ycao, patch: disabling ? { operational_status: "temporarily_unavailable", status_reason: result.hazard || result.summary, status_confidence: confidence, status_updated_at: new Date().toISOString() } : { operational_status: "operational", status_reason: undefined, status_confidence: confidence, status_updated_at: new Date().toISOString() }, summary: disabling ? `Temporarily disable ${airport.ycao} until manually reopened` : `Reopen ${airport.ycao}` };
        if (confidence > .85) {
          setAirports(items => items.map(a => a.ycao === proposal.code ? { ...a, ...proposal.patch } : a));
          setChanges(c => c + 1); setSelected(proposal.code);
          setChat(items => [...items, { role: "assistant", confidence, text: `${result.summary}${evidence}\nConfidence is above 0.85. ${proposal.summary} was applied automatically.` }]);
        } else {
          setChat(items => [...items, { role: "assistant", confidence, proposal, text: `${result.summary}${evidence}\nConfidence does not exceed 0.85. Confirm before applying: ${proposal.summary}.` }]);
        }
      } else {
        setChat(items => [...items, { role: "assistant", confidence, text: `${result.summary}${evidence}\nNo operational change was made.` }]);
      }
    } catch (error) {
      setChat(items => [...items, { role: "assistant", confidence: 0, text: error instanceof Error ? error.message : "The image could not be analyzed." }]);
    } finally {
      setAnalyzing(false); setImage(null); setInput("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function reopenAirport(code: string) {
    const proposal: Proposal = { code, patch: { operational_status: "operational", status_reason: undefined, status_confidence: 1, status_updated_at: new Date().toISOString() }, summary: `Reopen ${code}` };
    applyChange(proposal);
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
        <button className="rail-btn" aria-label="Layers">▱</button><button className={`rail-btn ${settingsOpen ? "active" : ""}`} aria-label="Settings" aria-pressed={settingsOpen} onClick={() => setSettingsOpen(v => !v)}>⚙</button>
        <button className="rail-btn help" aria-label="Help">?</button>
      </aside>

      <div className="map-stage">
        <div className="map-heading"><div><span className="eyebrow">OPERATIONS OVERVIEW</span><h1>Pacific Air Mobility</h1><p>{visible.filter(a => a.operational_status !== "temporarily_unavailable").length} airfields online · Session data</p></div>
          <button className="session-pill"><i /> {changes ? `${changes} SESSION CHANGE${changes > 1 ? "S" : ""}` : "ORIGINAL DATA"}</button>
        </div>
        <div className="globe-wrap"><div className="orbit one"/><div className="orbit two"/><GlobeMap airports={visible} selected={selected} onSelect={setSelected} onHover={setHovered} /></div>
        <div className="drag-hint"><span>↔</span> DRAG TO ROTATE · SCROLL TO ZOOM</div>
        <div className="filter-bar"><div className="select-wrap"><span>AIRCRAFT COMPATIBILITY</span><select value={aircraft} onChange={e => setAircraft(e.target.value)}><option>All aircraft</option><option>C-130</option><option>C-17</option><option>C-5</option></select></div><div className="legend"><span><i className="dot c5"/>C-5</span><span><i className="dot c17"/>C-17</span><span><i className="dot c130"/>C-130</span><span className="divider"/><span><i className="hub-shape"/>Hub</span><span><i className="spoke-shape"/>Spoke</span></div></div>
      </div>

      {active && <aside className="detail-panel">
        <button className="close" onClick={() => setSelected(null)}>×</button><span className="eyebrow">AIRFIELD PROFILE</span><div className="detail-title"><div><h2>{active.name}</h2><p>{active.country}</p></div><b>{active.ycao}</b></div>
        <div className="role-row"><span className="role">{active.hub_spoke === "H" ? "◆ HUB" : "● SPOKE"}</span>{active.usage && <span>{active.usage === "Mil" ? "MILITARY" : active.usage === "Civ" ? "CIVIL" : "JOINT USE"}</span>}<span className={`status ${active.operational_status === "temporarily_unavailable" ? "closed" : ""}`}>{active.operational_status === "temporarily_unavailable" ? "UNAVAILABLE" : "OPERATIONAL"}</span></div>
        {active.operational_status === "temporarily_unavailable" && <div className="status-alert"><b>⚠ Temporarily unavailable</b><p>{active.status_reason}</p>{active.status_confidence != null && <small>ASSESSMENT CONFIDENCE · {Math.round(active.status_confidence * 100)}%</small>}<button onClick={() => reopenAirport(active.ycao)}>Manually reopen airfield</button></div>}
        <section className="capacity"><h3>Capacity at a glance</h3><div className="capacity-grid"><div><Icon>✈</Icon><span><b>{active.runway_capability}</b><small>MAX AIRCRAFT</small></span></div><div><Icon>↔</Icon><span><b>{active.max_working ?? "—"}</b><small>MAX WORKING</small></span></div><div><Icon>▦</Icon><span><b>{active.parking ?? 0}</b><small>CURRENT PARKED</small></span></div><div><Icon>━</Icon><span><b>{active.number_of_runways}</b><small>RUNWAYS</small></span></div></div></section>
        <section><h3>Ground capabilities</h3><div className="capabilities">{CAP_FIELDS.map(field => active[field] == null ? null : <div key={field}><span className={active[field] ? "yes" : "no"}>{active[field] ? "✓" : "×"}</span><b>{LABELS[field]}</b><small>{active[field] ? "AVAILABLE" : "NOT AVAILABLE"}</small></div>)}</div></section>
        <section><h3>Location</h3><div className="location"><span>LATITUDE<b>{active.latitude == null ? "—" : `${Math.abs(active.latitude).toFixed(2)}° ${active.latitude >= 0 ? "N" : "S"}`}</b></span><span>LONGITUDE<b>{active.longitude == null ? "—" : `${Math.abs(active.longitude).toFixed(2)}° ${active.longitude >= 0 ? "E" : "W"}`}</b></span></div></section>
        <button className="ask" onClick={() => { setChatOpen(true); setInput(`Tell me about ${active.ycao}`); }}>✦ Ask Atlas about this airfield</button>
      </aside>}
      {settingsOpen && <aside className="settings-drawer">
        <div className="settings-head"><div><span className="eyebrow">SESSION CONFIGURATION</span><h2>Settings</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></div>
        <section><label className="settings-label"><span>⌾ CURRENT LOCATION</span><small>Used when you refer to “this airport” in chat.</small><select value={currentAirport} onChange={e => { setCurrentAirport(e.target.value); if (e.target.value) setSelected(e.target.value); }}><option value="">Select an airfield</option>{airports.filter(a => a.latitude != null).sort((a,b) => a.name.localeCompare(b.name)).map(a => <option key={a.ycao} value={a.ycao}>{a.ycao} · {a.name}</option>)}</select></label></section>
        <section><label className="settings-label"><span>OPENAI API KEY</span><small>Required for image analysis. Kept only in memory for this browser session.</small><div className="key-input"><input type={showKey ? "text" : "password"} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" spellCheck={false}/><button type="button" onClick={() => setShowKey(v => !v)}>{showKey ? "HIDE" : "SHOW"}</button></div></label><div className={`key-status ${apiKey ? "ready" : ""}`}><i/>{apiKey ? "Session key ready" : "No session key configured"}</div></section>
        <div className="security-note"><b>Session-only security</b><p>The key is not saved to local storage, cookies, airport data, or application logs. It is sent only with analysis requests and is cleared when this page closes.</p></div>
        {apiKey && <button className="clear-key" onClick={() => { setApiKey(""); setShowKey(false); }}>Clear API key</button>}
      </aside>}
    </section>

    <section className={`chat-panel ${chatOpen ? "open" : ""}`}>
      <button className="chat-toggle" onClick={() => setChatOpen(!chatOpen)}><span>✦</span><b>Atlas Assistant</b><i>{chatOpen ? "×" : "↑"}</i></button>
      {chatOpen && <><div className="chat-head"><div><span className="ai-glyph">✦</span><div><b>Atlas Assistant</b><small><i/> AIRFIELD INTELLIGENCE</small></div></div><button onClick={() => setChatOpen(false)}>—</button></div><div className="model-bar"><label>VISION MODEL<select value={model} onChange={e => setModel(e.target.value)}><option value="gpt-5.6-terra">GPT-5.6 Terra · Balanced</option><option value="gpt-5.6-luna">GPT-5.6 Luna · Efficient</option><option value="gpt-5.4-mini">GPT-5.4 mini · Fast</option><option value="gpt-5.4-nano">GPT-5.4 nano · Lowest cost</option></select></label><span>{currentAirport || "NO LOCATION"}</span></div><div className="messages">{chat.map((m, i) => <div key={i} className={`message ${m.role}`}><span>{m.role === "assistant" ? "✦" : "YY"}</span><div>{m.imageName && <div className="image-receipt">▧ {m.imageName}<small>Analyzed transiently · not stored</small></div>}<p>{m.text}</p>{m.confidence != null && m.role === "assistant" && <div className={`confidence ${m.confidence > .85 ? "high" : m.confidence >= .6 ? "medium" : "low"}`}><span>CONFIDENCE</span><i><b style={{ width: `${Math.round(m.confidence * 100)}%` }}/></i><em>{Math.round(m.confidence * 100)}%</em></div>}{m.proposal && <button onClick={() => applyChange(m.proposal!)}>Confirm session change</button>}</div></div>)}{analyzing && <div className="message assistant"><span>✦</span><div><p className="thinking">Analyzing visible conditions and request clarity…</p></div></div>}</div>{image && <div className="upload-chip"><span>▧</span><div><b>{image.name}</b><small>{(image.size / 1024 / 1024).toFixed(1)} MB · deleted after analysis</small></div><button onClick={() => { setImage(null); if (fileInput.current) fileInput.current.value = ""; }}>×</button></div>}<form className="chat-input" onSubmit={(e: FormEvent) => { e.preventDefault(); void respond(input); }}><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={e => setImage(e.target.files?.[0] || null)}/><button type="button" className="upload-button" onClick={() => fileInput.current?.click()} title="Upload an airfield image">＋</button><input value={input} onChange={e => setInput(e.target.value)} placeholder={image ? "Describe when and where this was taken…" : "Ask or modify session data…"}/><button disabled={analyzing}>↑</button></form><p className="privacy">Images are deleted after analysis · Session edits clear on close.</p></>}
    </section>
  </main>;
}
