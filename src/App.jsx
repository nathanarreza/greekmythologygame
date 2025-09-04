import React, { useMemo, useState } from "react";

// --- Utility Dice ---
const d20 = () => Math.floor(Math.random() * 20) + 1;


// --- Core Types (lightweight) ---
/**
 * Character schema is intentionally generic so the rest of the
 * document's gods/heroes can be added with only data (no code changes).
 */
const PHY = "physical";
const MAG = "magical";

// Keyword effects supported by the engine (extend easily):
//  - stun, sleep, silence, burn, poison, shield, dr (damageReduction),
//  - regen, blind, taunt, weaken, bind/root, flight, antiHeal, reviveLock,
//  - forget (ability lock), rerollLow (disadvantage), rerollHigh (advantage)



// Library: a SMALL starter set taken from the doc so you can test.
// You can add ALL remaining characters by pasting them into the
// "Add/Import Characters" drawer in the app (JSON). The engine will
// handle them. Use the same structure.

import STARTER_CHARACTERS from "../characters.json";


// --- Minimal rules engine ---
const initialState = {
    phase: "draft", // draft | combat
    log: [],
    round: 0,
    turnIndex: 0,
    order: [], // array of {cid, roll}
    hazard: { thunderstorm: false },
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function formatRoll(n) { return `d20(${n})`; }

function computeBaseDamage(ability, attacker) {
    const stat = ability.type === PHY ? attacker.stats.STR : attacker.stats.MAG;
    return ability.power + stat + (ability.bonus ? (ability.bonus() || 0) : 0);
}

function applyDamage(target, dmg, opts = {}) {
    const t = target;
    const taken = Math.max(0, dmg); // No defense stat in this ruleset; reductions handled via statuses optionally
    t.stats.HP -= taken;
    t.stats.HP = Math.max(t.stats.HP, 0);
    return taken;
}

function hasStatus(c, key) {
    return (c.statuses || []).some((s) => s.key === key && s.duration > 0);
}

function addStatus(c, eff) {
    if (!c.statuses) c.statuses = [];
    // Merge if exists
    const idx = c.statuses.findIndex((s) => s.key === eff.key);
    if (idx >= 0) {
        c.statuses[idx].duration = Math.max(c.statuses[idx].duration, eff.duration);
        c.statuses[idx].power = Math.max(c.statuses[idx].power, eff.power);
        return;
    }
    c.statuses.push(clone(eff));
}

function tickStatuses(c) {
    if (!c.statuses) return [];
    const log = [];
    c.statuses.forEach((s) => {
        // DoT / Regen basic processing
        if (s.key === "burn" || s.key === "poison") {
            const dmg = Math.max(0, s.power || 2);
            c.stats.HP = Math.max(0, c.stats.HP - dmg);
            log.push(`${c.name} suffers ${dmg} from ${s.key}.`);
        }
        if (s.key === "regen") {
            const heal = Math.max(0, s.power || 5);
            c.stats.HP += heal;
            log.push(`${c.name} regenerates ${heal} HP.`);
        }
        s.duration -= 1;
    });
    // cleanup
    c.statuses = c.statuses.filter((s) => s.duration > 0);
    return log;
}

function rollInitiativeRound(living) {
    // Everyone rolls d20; ties re-roll among tied until unique order
    let rolls = living.map((c) => ({ cid: c.id, roll: d20() }));
    let changed = true;
    while (changed) {
        changed = false;
        const map = new Map();
        rolls.forEach((r) => {
            const list = map.get(r.roll) || [];
            list.push(r);
            map.set(r.roll, list);
        });
        for (const [, list] of map.entries()) {
            if (list.length > 1) {
                // re-roll these
                list.forEach((item) => (item.roll = d20()));
                changed = true;
            }
        }
    }
    rolls.sort((a, b) => b.roll - a.roll);
    return rolls;
}

function teamOf(state, cid) {
    return state.teams[0].some((c) => c.id === cid) ? 0 : 1;
}

// --- React App ---
export default function App() {
    const [state, setState] = useState({ ...initialState, teams: [[], []] });
    const [library, setLibrary] = useState(STARTER_CHARACTERS);
    const [importOpen, setImportOpen] = useState(false);

    const living = useMemo(() => {
        if (!state.teams) return [];
        return [...state.teams[0], ...state.teams[1]].filter((c) => c.stats.HP > 0);
    }, [state.teams, state.round]);

    const current = useMemo(() => {
        if (state.phase !== "combat") return null;
        const id = state.order[state.turnIndex]?.cid;
        const all = [...state.teams[0], ...state.teams[1]];
        return all.find((c) => c.id === id) || null;
    }, [state]);

    function addToTeam(idx, char) {
        setState((s) => {
            if (s.teams[idx].length >= 4) return s;
            const copy = clone(s);
            copy.teams[idx].push(clone(char));
            return copy;
        });
    }

    function removeFromTeam(idx, id) {
        setState((s) => {
            const copy = clone(s);
            copy.teams[idx] = copy.teams[idx].filter((c) => c.id !== id);
            return copy;
        });
    }

    function startBattle() {
        const all = [...state.teams[0], ...state.teams[1]];
        if (state.teams[0].length !== 4 || state.teams[1].length !== 4) return;
        const order = rollInitiativeRound(all);
        setState((s) => ({
            ...s,
            phase: "combat",
            round: 1,
            order,
            turnIndex: 0,
            log: [
                `Round 1 begins! Initiative: ${order.map((o) => `${all.find((c) => c.id === o.cid)?.name} ${formatRoll(o.roll)}`).join(", ")}`,
            ],
        }));
    }

    function endTurnAndAdvance(nextLog = []) {
        setState((s) => {
            const copy = clone(s);
            // Advance turn index; if end of round -> new round, re-roll initiative
            let ti = copy.turnIndex + 1;
            let newOrder = copy.order;
            let round = copy.round;
            const allChars = [...copy.teams[0], ...copy.teams[1]].filter((c) => c.stats.HP > 0);
            if (ti >= newOrder.length) {
                // End of round - apply end-of-round hazard and status ticks
                const rlog = [];
                if (copy.hazard.thunderstorm) {
                    allChars.forEach((c) => {
                        const isZeus = c.id === "ZEUS";
                        const flying = !!c.canFly;
                        if (isZeus) return;
                        const dmg = flying ? 8 : 4;
                        c.stats.HP = Math.max(0, c.stats.HP - dmg);
                        rlog.push(`Thunderstorm zaps ${c.name} for ${dmg}.`);
                    });
                }
                // Status ticks at END of round
                allChars.forEach((c) => rlog.push(...tickStatuses(c)));

                round += 1;
                newOrder = rollInitiativeRound(allChars);
                ti = 0;
                return { ...copy, round, order: newOrder, turnIndex: ti, log: [...copy.log, ...nextLog, ...rlog, `Round ${round} begins! Initiative set.`] };
            }
            return { ...copy, turnIndex: ti, log: [...copy.log, ...nextLog] };
        });
    }

    function performAttack(attacker, ability, target) {
        if (!attacker || !ability || !target) return;
        const logs = [];

        // Check hard disables
        if (hasStatus(attacker, "stun") || hasStatus(attacker, "sleep")) {
            logs.push(`${attacker.name} is disabled and loses the turn.`);
            return endTurnAndAdvance(logs);
        }

        // ATTACK ROLL (global house rule)
        const atkRoll = d20();
        let outcome = "miss";
        let extra = 0;
        let trueFlag = false;
        if (atkRoll <= 5) outcome = "miss";
        else if (atkRoll <= 15) { outcome = "slight"; extra = 20; }
        else if (atkRoll <= 19) { outcome = "normal"; trueFlag = true; }
        else { outcome = "crit"; extra = 20; }

        let base = computeBaseDamage(ability, attacker);

        // Ares Battle Frenzy example (simple): thresholds at <120/<75/<1
        if (attacker.id === "ARES") {
            const hp = attacker.stats.HP;
            if (hp < 1) base += 10; else if (hp < 75) base += 5; else if (hp < 120) base += 2;
        }

        let total = outcome === "miss" ? 0 : base + extra;

        // Artemis passive: never miss vs conditioned targets
        if (attacker.id === "ARTEMIS" && outcome === "miss" && (target.statuses || []).length) {
            outcome = "slight"; total = base + 20; // treat as slight
        }

        // Apply damage
        const dealt = applyDamage(target, total, { true: trueFlag });




        if (target.stats.HP <= 0){
            setState((s) => {
                const copy = clone(s);
                copy.order = copy.order.filter(obj => obj.cid !== target.id);
                return copy;

            });
        }

        logs.push(`${attacker.name} uses ${ability.name} on ${target.name} — roll ${atkRoll} (${outcome}). Deals ${dealt} damage.`);



        // Thanatos instant-execute below 40 HP when damaged by him
        if (attacker.id === "THANATOS" && target.stats.HP > 0 && target.stats.HP < 40) {
            target.stats.HP = 0;
            logs.push(`Embrace of Death: ${target.name} is instantly taken by Thanatos!`);
            attacker.stats.HP = Math.min(attacker.stats.HP + 25, attacker.stats.HP + 25); // simple +25, no max tracked
        }

        // EFFECT ROLL (50/50 success on d20; 20 = boosted)
        if (ability.effects && ability.effects.duration) {
            const effRoll = d20();
            if (effRoll <= 10) {
                logs.push(`Effect check d20(${effRoll}) — fails.`);
            } else {
                const boosted = effRoll === 20;
                ability.effects.forEach((e) => {
                    const eff = clone(e);
                    if (boosted) Object.assign(eff, eff.boosted ? eff.boosted(eff) : { duration: eff.duration + 1 });
                    addStatus(target, eff);
                });
                logs.push(`Effect check d20(${effRoll}) — ${boosted ? "CRITICAL EFFECT!" : "success"}.`);
            }
        }

        // End-of-attack cleanups
        attacker.lastCast = ability.id;

        // Auto-win check
        const all = [...state.teams[0], ...state.teams[1]];
        const teamHP = [
            state.teams[0].reduce((a, c) => a + Math.max(0, c.stats.HP), 0),
            state.teams[1].reduce((a, c) => a + Math.max(0, c.stats.HP), 0),
        ];



        const defeatedTeam = teamHP.findIndex((sum) => sum <= 0);
        if (defeatedTeam >= 0) {
            setState((s) => ({ ...s, log: [...s.log, ...logs, `Team ${defeatedTeam === 0 ? "A" : "B"} has fallen. GG!`] }));
            return;
        }

        endTurnAndAdvance(logs);

    }

    function endTurnNoAction() {
        endTurnAndAdvance([`${current?.name} does nothing.`]);
    }

    function toggleHazard(name) {
        setState((s) => ({ ...s, hazard: { ...s.hazard, [name]: !s.hazard[name] }, log: [...s.log, `${name} ${(s.hazard[name] ? "deactivated" : "activated")}.`] }));
    }

    function resetMatch() {
        setState({ ...initialState, teams: [[], []] });
    }

    // --- UI helpers ---
    const bench = library.filter((x) => !state.teams[0].some((c) => c.id === x.id) && !state.teams[1].some((c) => c.id === x.id));

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4">
            <div className="max-w-7xl mx-auto grid gap-4">
                <header className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">Clash of the Gods || Crispy Luto</h1>
                    <div className="flex gap-2">
                        <button onClick={() => setImportOpen(!importOpen)} className="px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700">Add/Import Characters</button>
                        <button onClick={resetMatch} className="px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700">Reset</button>
                    </div>
                </header>

                {importOpen && (
                    <Importer library={library} setLibrary={setLibrary} close={() => setImportOpen(false)} />
                )}

                {state.phase === "draft" && (
                    <div className="flex items-center gap-3">
                        <button disabled={state.teams[0].length !== 4 || state.teams[1].length !== 4} onClick={startBattle} className="px-4 py-2 rounded-2xl bg-indigo-600 ">Start Battle</button>
                        <div className="text-sm opacity-70">Pick 4 per team. Initiative is re-rolled each round; ties re-roll until unique.</div>
                    </div>
                )}

                {state.phase === "draft" && (
                    <section className="grid md:grid-cols-3 gap-4">
                        <TeamPanel title="Team A" team={0} roster={state.teams[0]} onRemove={removeFromTeam} />

                        <TeamPanel title="Team B" team={1} roster={state.teams[1]} onRemove={removeFromTeam} />
                        <BenchPanel bench={bench} onAdd={addToTeam} />
                    </section>
                )}



                {state.phase === "combat" && (
                    <section className="grid md:grid-cols-[1fr_420px] gap-4">
                        <Board state={state} setState={setState} toggleHazard={toggleHazard} performAttack={performAttack} endTurnNoAction={endTurnNoAction} />
                        <LogPanel log={state.log} />
                    </section>
                )}
            </div>
        </div>
    );
}

function TeamPanel({ title, team, roster, onRemove }) {
    return (
        <div className="rounded-2xl bg-neutral-900 p-3">
            <div className="flex items-center justify-between">
                <h2 className="font-semibold">{title}</h2>
                <span className="text-xs opacity-70">{roster.length}/4</span>
            </div>
            <div className="mt-2 grid gap-2">
                {roster.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-xl bg-neutral-800 p-2">
                        <div>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs opacity-70">HP {c.stats.HP} · STR {c.stats.STR} · MAG {c.stats.MAG} · WIS {c.stats.WIS}</div>
                        </div>
                        <button onClick={() => onRemove(team, c.id)} className="text-xs px-2 py-1 rounded-lg bg-neutral-700">Remove</button>
                    </div>
                ))}
                {roster.length === 0 && <div className="text-sm opacity-60">Pick from bench ➜</div>}
            </div>
        </div>
    );
}

function BenchPanel({ bench, onAdd }) {
    const [query, setQuery] = useState("");

    // Filter bench by name
    const filteredBench = bench.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase())
    );

    return (
        <div className="rounded-2xl bg-neutral-900 p-3">
            <h2 className="font-semibold">Bench</h2>

            {/* Search bar */}
            <input
                type="text"
                placeholder="Search..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="mt-2 w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />

            <div className="mt-2 grid sm:grid-cols-2 gap-2">
                {filteredBench.map((c) => (
                    <div key={c.id} className="rounded-xl bg-neutral-800 p-2">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs opacity-70">
                            HP {c.stats.HP} · STR {c.stats.STR} · MAG {c.stats.MAG} · WIS {c.stats.WIS}
                        </div>
                        <div className="text-xs opacity-60 mt-1 line-clamp-2">
                            {c.passive?.name}
                        </div>
                        <div className="mt-2 flex gap-2">
                            <button
                                onClick={() => onAdd(0, c)}
                                className="px-2 py-1 rounded-lg bg-emerald-700 text-xs"
                            >
                                Add to Team A
                            </button>
                            <button
                                onClick={() => onAdd(1, c)}
                                className="px-2 py-1 rounded-lg bg-rose-700 text-xs"
                            >
                                Add to Team B
                            </button>
                        </div>
                    </div>
                ))}

                {filteredBench.length === 0 && (
                    <div className="col-span-full text-sm text-center opacity-60">
                        No results found
                    </div>
                )}
            </div>
        </div>
    );
}

function Board({ state, setState, toggleHazard, performAttack, endTurnNoAction }) {
    const all = [...state.teams[0], ...state.teams[1]];
    const currentId = state.order[state.turnIndex]?.cid;
    const current = all.find((c) => c.id === currentId);
    const enemies = state.order.length ? (teamOf(state, currentId) === 0 ? state.teams[1] : state.teams[0]) : [];
    const allies = teamOf(state, currentId) === 0 ? state.teams[0] : state.teams[1];

    const canPlay = current?.stats.HP > 0;

    return (
        <div className="rounded-2xl bg-neutral-900 p-3 grid gap-3">
            <div className="flex items-center justify-between">
                <div>
                    <div className="font-semibold">Round {state.round}</div>
                    <div className="text-xs opacity-70">Order: {state.order.map((o, i) => `${i === state.turnIndex ? "➡️ " : ""}${all.find((c) => c.id === o.cid)?.name}`).join(" · ")}</div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <button onClick={() => toggleHazard("thunderstorm")} className={`px-2 py-1 rounded-lg ${state.hazard.thunderstorm ? "bg-indigo-700" : "bg-neutral-800"}`}>Thunderstorm</button>
                    <button onClick={endTurnNoAction} className="px-2 py-1 rounded-lg bg-neutral-800">End Turn</button>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
                <Side title="Team A" list={state.teams[0]} currentId={currentId} />
                <Side title="Team B" list={state.teams[1]} currentId={currentId} />
            </div>

            {current && (
                <div className="rounded-xl bg-neutral-800 p-3">
                    <div className="font-semibold mb-2">{current.name}’s turn</div>
                    <div className="text-xs opacity-70 mb-2">Statuses: {(current.statuses || []).map((s) => `${s.key}(${s.duration})`).join(", ") || "—"}</div>
                    <div className="grid gap-2">

                        {current.abilities.map((ab) => (
                            <AbilityRow key={ab.id} ab={ab} attacker={current} allies={allies} enemies={enemies} onCast={(tgt) => performAttack(current, ab, tgt)} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function Side({ title, list, currentId }) {
    return (
        <div className="rounded-xl bg-neutral-800 p-2">
            <div className="font-medium mb-2">{title}</div>
            <div className="grid gap-2">
                {list.map((c) => (
                    <div key={c.id} className={`rounded-lg p-2 ${c.id === currentId ? "bg-neutral-700" : "bg-neutral-900"}`}>
                        <div className="flex items-center justify-between">
                            <div className="font-semibold">{c.name}</div>
                            <div className="text-xs">HP {c.stats.HP}</div>
                        </div>
                        <div className="text-[10px] opacity-70">STR {c.stats.STR} · MAG {c.stats.MAG} · WIS {c.stats.WIS}</div>
                        <div className="text-[10px] opacity-60">{(c.statuses || []).map((s) => s.key).join(", ")}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function AbilityRow({ ab, attacker, allies, enemies, onCast }) {
    const [targetId, setTargetId] = useState(enemies[0]?.id || "");
    return (
        <div className="rounded-lg bg-neutral-900 p-2">
            <div className="flex items-center justify-between">
                <div>
                    <div className="font-medium">{ab.name} <span className="text-xs opacity-60">({ab.type}, P{ab.power})</span></div>
                    <div className="text-xs opacity-70 max-w-prose">{ab.text}</div>
                </div>
                <div className="flex items-center gap-2">
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="bg-neutral-800 text-xs rounded px-2 py-1">
                        {enemies.map((e) => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                    </select>
                    <button onClick={() => onCast(enemies.find((e) => e.id === targetId))} className="text-xs px-2 py-1 rounded-lg bg-emerald-700">Cast</button>
                </div>
            </div>
        </div>
    );
}

function LogPanel({ log }) {
    return (
        <div className="rounded-2xl bg-neutral-900 p-3 h-[70vh] overflow-auto">
            <div className="font-semibold mb-2">Battle Log</div>
            <div className="space-y-1 text-sm">
                {log.map((l, i) => (
                    <div key={i} className="opacity-90">{l}</div>
                ))}
            </div>
        </div>
    );
}

function Importer({ library, setLibrary, close }) {
    const [text, setText] = useState(JSON.stringify(library, null, 2));
    return (
        <div className="rounded-2xl bg-neutral-900 p-3">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold">Add/Import Characters (JSON)</h3>
                <button onClick={close} className="px-2 py-1 text-xs rounded-lg bg-neutral-800">Close</button>
            </div>
            <p className="text-xs opacity-70 mt-1">Paste the rest of the document’s characters here. Use this schema per character:
                <code className="block bg-black/40 p-2 rounded mt-1">{
                    '{'} id, name, canFly?, stats: {'{'}HP, STR, MAG, WIS{'}'}, passive: {'{'}name,text{'}'}, abilities: [ {'{'}id, name, power, type: "physical"|"magical", text, effects?: [ {'{'} key, duration, power, note? {'}'} ]{'}'} ] {'}'} </code>
            </p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} className="w-full h-64 mt-2 rounded bg-neutral-800 p-2 font-mono text-xs" />
            <div className="flex gap-2 mt-2">
                <button onClick={() => { try { const parsed = JSON.parse(text); setLibrary(parsed); } catch (e) { alert("Invalid JSON"); } }} className="px-3 py-1 rounded-lg bg-emerald-700">Replace Library</button>
                <button onClick={() => { try { const parsed = JSON.parse(text); setLibrary((prev) => [...prev, ...parsed]); } catch (e) { alert("Invalid JSON"); } }} className="px-3 py-1 rounded-lg bg-indigo-700">Append</button>
            </div>
        </div>
    );
}
