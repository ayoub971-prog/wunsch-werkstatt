#!/usr/bin/env python3
"""Aktualisiert models.json: fragt oeffentliche Modell-Listen ab (OpenRouter ohne Schluessel;
Gemini/Groq/Mistral nur wenn Repo-Secrets vorhanden). Schluessel nur als Header, nie in URL oder Datei."""
import json, os, re, datetime, urllib.request

def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "wunsch-werkstatt", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def ver(s):
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", s)] or [0]

old = json.load(open("models.json"))
by = {}
for x in old["chain"]:
    by.setdefault(x["provider"], []).append(x["model"])

k = os.environ.get("GEMINI_API_KEY")
if k:
    try:
        ms = get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {"x-goog-api-key": k})["models"]
        ids = [m["name"].split("/")[-1] for m in ms if "generateContent" in m.get("supportedGenerationMethods", [])]
        ok = [i for i in ids if re.fullmatch(r"gemini-\d+(\.\d+)?-flash(-lite)?(-latest)?", i)]
        flash = sorted([i for i in ok if "lite" not in i], key=ver, reverse=True)
        lite = sorted([i for i in ok if "lite" in i], key=ver, reverse=True)
        pick = (flash[:1] + lite[:1]) or by.get("gemini", [])
        if pick: by["gemini"] = pick
        print("gemini", pick)
    except Exception as e: print("gemini skip", e)
else: print("gemini: kein Secret, bleibt", by.get("gemini"))

def oai(name, base, env, prefs):
    key = os.environ.get(env)
    if not key: print(name + ": kein Secret, bleibt", by.get(name)); return
    try:
        ids = [m["id"] for m in get(base + "/models", {"Authorization": "Bearer " + key})["data"]]
        pick = [p for p in prefs if p in ids][:2]
        if pick: by[name] = pick
        print(name, pick)
    except Exception as e: print(name + " skip", e)

oai("groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY", ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct", "qwen/qwen3-32b"])
oai("mistral", "https://api.mistral.ai/v1", "MISTRAL_API_KEY", ["mistral-medium-latest", "mistral-small-latest", "codestral-latest"])

try:
    data = get("https://openrouter.ai/api/v1/models")["data"]
    free = [m for m in data if m["id"].endswith(":free") and (m.get("context_length") or 0) >= 32000]
    good = re.compile(r"coder|code|qwen|deepseek|gpt-oss|llama-3\.3|gemma|kimi|glm", re.I)
    free.sort(key=lambda m: (not good.search(m["id"]), -(m.get("context_length") or 0)))
    by["openrouter"] = ["openrouter/free"] + [m["id"] for m in free[:2]]
    print("openrouter", by["openrouter"])
except Exception as e: print("openrouter skip", e)

order = ["gemini", "groq", "mistral", "openrouter"]
chain = [{"provider": p, "model": m} for p in order for m in by.get(p, [])]
new = {"updated": datetime.date.today().isoformat(), "note": old.get("note", ""), "chain": chain}
if chain != old["chain"]:
    json.dump(new, open("models.json", "w"), indent=2); print("models.json aktualisiert")
else: print("keine Aenderung")
